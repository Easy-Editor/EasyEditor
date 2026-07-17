import { lookup as defaultLookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { DataProxyError } from './errors.mjs'

const parseIpv4 = address => {
  const parts = address.split('.').map(part => Number.parseInt(part, 10))
  if (parts.length !== 4 || parts.some((part, index) => !/^\d+$/.test(address.split('.')[index]) || part > 255)) {
    return null
  }
  return parts
}

const parseIpv6 = address => {
  const value = address.toLowerCase()
  if (value.includes('%') || value.split('::').length > 2) return null
  let embeddedIpv4 = false
  const [leftText, rightText = ''] = value.split('::')
  const expand = text => {
    if (!text) return []
    const groups = text.split(':')
    const last = groups.at(-1)
    if (last?.includes('.')) {
      embeddedIpv4 = true
      const ipv4 = parseIpv4(last)
      if (!ipv4) return null
      groups.splice(-1, 1, ((ipv4[0] << 8) | ipv4[1]).toString(16), ((ipv4[2] << 8) | ipv4[3]).toString(16))
    }
    if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null
    return groups.map(group => Number.parseInt(group, 16))
  }
  const left = expand(leftText)
  const right = expand(rightText)
  if (!left || !right) return null
  if (!value.includes('::') && left.length !== 8) return null
  const missing = 8 - left.length - right.length
  if (missing < (value.includes('::') ? 1 : 0)) return null
  return { embeddedIpv4, groups: [...left, ...Array.from({ length: missing }, () => 0), ...right] }
}

const isForbiddenIpv4 = parts => {
  const [a, b, c, d] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 168 && b === 63 && c === 129 && d === 16) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 31 && c === 196) ||
    (a === 192 && b === 52 && c === 193) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 175 && c === 48) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

export const isForbiddenAddress = address => {
  const normalized = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address
  const family = isIP(normalized)
  if (family === 4) return isForbiddenIpv4(parseIpv4(normalized))
  if (family !== 6) return true

  const parsed = parseIpv6(normalized)
  if (!parsed) return true
  const { embeddedIpv4, groups } = parsed
  const allZero = groups.every(group => group === 0)
  const loopback = groups.slice(0, 7).every(group => group === 0) && groups[7] === 1
  const mappedIpv4 = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff
  const compatibleIpv4 = groups.slice(0, 6).every(group => group === 0)
  const translatedIpv4 = groups.slice(0, 4).every(group => group === 0) && groups[4] === 0xffff && groups[5] === 0
  const sixToFour = groups[0] === 0x2002
  const teredo = groups[0] === 0x2001 && groups[1] === 0
  const isatap = groups[5] === 0x5efe
  const discardOnly = groups[0] === 0x0100 && groups.slice(1, 4).every(group => group === 0)
  const ietfProtocolAssignments = groups[0] === 0x2001 && (groups[1] & 0xfe00) === 0
  const documentation = groups[0] === 0x2001 && groups[1] === 0x0db8
  const documentationV2 = groups[0] === 0x3fff && (groups[1] & 0xf000) === 0
  const segmentRouting = groups[0] === 0x5f00
  const directDelegationAs112 = groups[0] === 0x2620 && groups[1] === 0x004f && groups[2] === 0x8000
  return (
    embeddedIpv4 ||
    allZero ||
    loopback ||
    mappedIpv4 ||
    compatibleIpv4 ||
    translatedIpv4 ||
    sixToFour ||
    teredo ||
    isatap ||
    discardOnly ||
    ietfProtocolAssignments ||
    documentation ||
    documentationV2 ||
    segmentRouting ||
    directDelegationAs112 ||
    (groups[0] & 0xfe00) === 0xfc00 ||
    (groups[0] & 0xffc0) === 0xfe80 ||
    (groups[0] & 0xffc0) === 0xfec0 ||
    (groups[0] & 0xff00) === 0xff00 ||
    (groups[0] === 0x0064 && groups[1] === 0xff9b)
  )
}

const normalizeLookupResult = result => {
  const records = Array.isArray(result) ? result : [result]
  return records.map(record => {
    const address = typeof record === 'string' ? record : record?.address
    const family = typeof record === 'object' && record?.family ? Number(record.family) : isIP(address ?? '')
    if (!address || (family !== 4 && family !== 6) || isForbiddenAddress(address)) {
      throw new DataProxyError('destination-denied', 403, 'Destination is not allowed')
    }
    return { address, family }
  })
}

export const resolvePinnedDestination = async (url, lookup = defaultLookup) => {
  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  const literalFamily = isIP(hostname)
  const records = literalFamily
    ? normalizeLookupResult([{ address: hostname, family: literalFamily }])
    : normalizeLookupResult(await lookup(hostname, { all: true, verbatim: true }))
  if (records.length === 0) throw new DataProxyError('destination-denied', 403, 'Destination is not allowed')
  const pinned = records[0]
  const pinnedLookup = (_hostname, options, callback) => {
    if (typeof options === 'function') {
      options(null, pinned.address, pinned.family)
      return
    }
    if (options?.all) callback(null, [pinned])
    else callback(null, pinned.address, pinned.family)
  }
  return { pinned, lookup: pinnedLookup }
}
