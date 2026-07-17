import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const keyFor = (packageName, range) => createHash('sha256').update(packageName).update('\0').update(range).digest('hex')

export const createOnlineComponentDependencyCache = ({ directory }) => ({
  async read(packageName, range) {
    const path = join(directory, `${keyFor(packageName, range)}.json`)
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  },

  async write(packageName, range, record) {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, `${keyFor(packageName, range)}.json`)
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      try {
        await link(temporaryPath, path)
        return record
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
        return JSON.parse(await readFile(path, 'utf8'))
      }
    } finally {
      await rm(temporaryPath, { force: true })
    }
  },
})
