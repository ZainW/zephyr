/**
 * TAP Device Management
 *
 * Creates and manages TAP network devices for Firecracker VMs.
 * Requires root/sudo privileges for network configuration.
 */

export interface TapDevice {
  /** TAP device name (e.g., "tap0") */
  name: string;
  /** MAC address assigned to the TAP device */
  mac?: string;
  /** IP address for the host side */
  hostIp?: string;
  /** IP address for the guest side */
  guestIp?: string;
  /** Subnet mask (e.g., "255.255.255.0") */
  netmask?: string;
}

export interface TapOptions {
  /** TAP device name */
  name: string;
  /** IP address for the host side of the TAP */
  hostIp?: string;
  /** Subnet mask */
  netmask?: string;
  /** Enable IP forwarding and NAT */
  enableNat?: boolean;
  /** External interface for NAT (e.g., "eth0") */
  natInterface?: string;
}

/**
 * Generate a random MAC address with the locally administered bit set
 */
export function generateMac(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);

  // Set locally administered bit (bit 1 of first byte)
  // Clear multicast bit (bit 0 of first byte)
  bytes[0] = (bytes[0]! | 0x02) & 0xfe;

  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(":");
}

/**
 * Create a TAP device
 *
 * Requires root/sudo privileges.
 */
export async function createTap(options: TapOptions): Promise<TapDevice> {
  const { name, hostIp, netmask = "255.255.255.252" } = options;

  // Create TAP device
  await Bun.$`sudo ip tuntap add dev ${name} mode tap`.quiet();

  // Bring up the interface
  await Bun.$`sudo ip link set ${name} up`.quiet();

  // Assign IP address if provided
  if (hostIp) {
    // Calculate CIDR prefix from netmask
    const prefix = netmaskToCidr(netmask);
    await Bun.$`sudo ip addr add ${hostIp}/${prefix} dev ${name}`.quiet();
  }

  return {
    name,
    hostIp,
    netmask,
  };
}

/**
 * Delete a TAP device
 */
export async function deleteTap(name: string): Promise<void> {
  try {
    await Bun.$`sudo ip link del ${name}`.quiet();
  } catch {
    // Device may not exist, ignore errors
  }
}

/**
 * Check if a TAP device exists
 */
export async function tapExists(name: string): Promise<boolean> {
  try {
    await Bun.$`ip link show ${name}`.quiet();
    return true;
  } catch {
    return false;
  }
}

/**
 * Enable IP forwarding on the host
 */
export async function enableIpForwarding(): Promise<void> {
  await Bun.$`sudo sysctl -w net.ipv4.ip_forward=1`.quiet();
}

/**
 * Set up NAT (masquerade) for VM traffic
 */
export async function setupNat(
  tapName: string,
  externalInterface: string
): Promise<void> {
  // Enable IP forwarding
  await enableIpForwarding();

  // Add iptables rules for NAT
  await Bun.$`sudo iptables -t nat -A POSTROUTING -o ${externalInterface} -j MASQUERADE`.quiet();
  await Bun.$`sudo iptables -A FORWARD -i ${tapName} -o ${externalInterface} -j ACCEPT`.quiet();
  await Bun.$`sudo iptables -A FORWARD -i ${externalInterface} -o ${tapName} -m state --state RELATED,ESTABLISHED -j ACCEPT`.quiet();
}

/**
 * Remove NAT rules
 */
export async function teardownNat(
  tapName: string,
  externalInterface: string
): Promise<void> {
  try {
    await Bun.$`sudo iptables -t nat -D POSTROUTING -o ${externalInterface} -j MASQUERADE`.quiet();
    await Bun.$`sudo iptables -D FORWARD -i ${tapName} -o ${externalInterface} -j ACCEPT`.quiet();
    await Bun.$`sudo iptables -D FORWARD -i ${externalInterface} -o ${tapName} -m state --state RELATED,ESTABLISHED -j ACCEPT`.quiet();
  } catch {
    // Rules may not exist
  }
}

/**
 * Convert netmask to CIDR prefix (e.g., "255.255.255.0" -> 24)
 */
function netmaskToCidr(netmask: string): number {
  const parts = netmask.split(".").map(Number);
  let bits = 0;
  for (const part of parts) {
    bits += (part >>> 0).toString(2).split("1").length - 1;
  }
  return bits;
}

/**
 * Network configuration for a VM
 */
export interface VmNetworkConfig {
  /** TAP device for this VM */
  tap: TapDevice;
  /** Guest IP address */
  guestIp: string;
  /** Guest MAC address */
  guestMac: string;
  /** Gateway IP (host TAP IP) */
  gateway: string;
  /** DNS server */
  dns: string;
}

/**
 * Allocate network configuration for a VM
 *
 * Uses a simple scheme: each VM gets a /30 subnet
 * Host: x.x.x.1, Guest: x.x.x.2
 */
export async function allocateNetwork(
  vmId: string,
  index: number,
  options: {
    baseSubnet?: string;
    natInterface?: string;
  } = {}
): Promise<VmNetworkConfig> {
  const { baseSubnet = "172.16", natInterface } = options;

  // Calculate subnet for this VM (each VM gets a /30)
  // Using 172.16.0.0/16 gives us 16384 possible /30 subnets
  const subnetIndex = index;
  const thirdOctet = Math.floor(subnetIndex / 64);
  const fourthOctetBase = (subnetIndex % 64) * 4;

  const hostIp = `${baseSubnet}.${thirdOctet}.${fourthOctetBase + 1}`;
  const guestIp = `${baseSubnet}.${thirdOctet}.${fourthOctetBase + 2}`;

  const tapName = `tap${index}`;
  const guestMac = generateMac();

  // Create TAP device
  const tap = await createTap({
    name: tapName,
    hostIp,
    netmask: "255.255.255.252", // /30
    enableNat: !!natInterface,
    natInterface,
  });

  // Set up NAT if requested
  if (natInterface) {
    await setupNat(tapName, natInterface);
  }

  return {
    tap,
    guestIp,
    guestMac,
    gateway: hostIp,
    dns: "8.8.8.8", // Google DNS
  };
}

/**
 * Release network configuration for a VM
 */
export async function releaseNetwork(
  config: VmNetworkConfig,
  natInterface?: string
): Promise<void> {
  // Teardown NAT if it was set up
  if (natInterface) {
    await teardownNat(config.tap.name, natInterface);
  }

  // Delete TAP device
  await deleteTap(config.tap.name);
}
