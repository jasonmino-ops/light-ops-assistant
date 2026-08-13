const OCTET_MAX = 255;

export function parseIpv4(value: string): [number, number, number, number] {
  const parts = value.trim().split(".");
  if (parts.length !== 4) {
    throw new Error(`INVALID_IPV4: ${value}`);
  }

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) {
      throw new Error(`INVALID_IPV4: ${value}`);
    }
    const octet = Number(part);
    if (octet < 0 || octet > OCTET_MAX) {
      throw new Error(`INVALID_IPV4: ${value}`);
    }
    return octet;
  });

  return octets as [number, number, number, number];
}

export function ipv4ToInt(value: string): number {
  const [a, b, c, d] = parseIpv4(value);
  return (((a << 24) >>> 0) + (b << 16) + (c << 8) + d) >>> 0;
}

export function intToIpv4(value: number): string {
  const normalized = value >>> 0;
  return [normalized >>> 24, (normalized >>> 16) & 255, (normalized >>> 8) & 255, normalized & 255].join(".");
}

export function prefixLengthToSubnetMask(prefixLength: number): string {
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > 32) {
    throw new Error(`INVALID_PREFIX_LENGTH: ${prefixLength}`);
  }
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return intToIpv4(mask);
}

export function subnetMaskToPrefixLength(subnetMask: string): number {
  const mask = ipv4ToInt(subnetMask);
  const inverted = (~mask) >>> 0;
  if (((inverted + 1) & inverted) !== 0) {
    throw new Error(`INVALID_SUBNET_MASK: ${subnetMask}`);
  }
  if (mask === 0) return 0;
  return 32 - Math.log2(inverted + 1);
}

export function calculateSubnet(ipv4: string, subnetMask: string) {
  const ip = ipv4ToInt(ipv4);
  const mask = ipv4ToInt(subnetMask);
  subnetMaskToPrefixLength(subnetMask);
  const network = (ip & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  return {
    networkAddress: intToIpv4(network),
    broadcastAddress: intToIpv4(broadcast),
    firstUsableAddress: network === broadcast ? null : intToIpv4((network + 1) >>> 0),
    lastUsableAddress: network === broadcast ? null : intToIpv4((broadcast - 1) >>> 0),
  };
}

export function isSameSubnet(leftIp: string, rightIp: string, subnetMask: string): boolean {
  const mask = ipv4ToInt(subnetMask);
  return ((ipv4ToInt(leftIp) & mask) >>> 0) === ((ipv4ToInt(rightIp) & mask) >>> 0);
}

export function isUsableHost(ipv4: string, subnetMask: string): boolean {
  const ip = ipv4ToInt(ipv4);
  const { networkAddress, broadcastAddress } = calculateSubnet(ipv4, subnetMask);
  return ip !== ipv4ToInt(networkAddress) && ip !== ipv4ToInt(broadcastAddress);
}
