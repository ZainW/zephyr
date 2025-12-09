/**
 * Firecracker API Types
 * Based on: https://github.com/firecracker-microvm/firecracker/blob/main/src/api_server/swagger/firecracker.yaml
 */

/**
 * Boot source configuration
 */
export interface BootSource {
  /** Path to the kernel image */
  kernel_image_path: string;
  /** Kernel boot arguments */
  boot_args?: string;
  /** Path to the initrd image (optional) */
  initrd_path?: string;
}

/**
 * Drive configuration for block devices
 */
export interface Drive {
  /** Unique identifier for the drive */
  drive_id: string;
  /** Path to the disk image file */
  path_on_host: string;
  /** Whether the drive is the root device */
  is_root_device: boolean;
  /** Whether the drive is read-only */
  is_read_only: boolean;
  /** Rate limiter for the drive (optional) */
  rate_limiter?: RateLimiter;
  /** Partuuid for the drive (optional) */
  partuuid?: string;
  /** Cache type: Unsafe or Writeback */
  cache_type?: "Unsafe" | "Writeback";
  /** IO engine: Sync or Async */
  io_engine?: "Sync" | "Async";
}

/**
 * Network interface configuration
 */
export interface NetworkInterface {
  /** Unique identifier for the interface */
  iface_id: string;
  /** Name of the host TAP device */
  host_dev_name: string;
  /** Guest MAC address (optional, auto-generated if not specified) */
  guest_mac?: string;
  /** Rate limiter for RX (optional) */
  rx_rate_limiter?: RateLimiter;
  /** Rate limiter for TX (optional) */
  tx_rate_limiter?: RateLimiter;
}

/**
 * Rate limiter configuration
 */
export interface RateLimiter {
  /** Bandwidth rate limiter */
  bandwidth?: TokenBucket;
  /** Operations rate limiter */
  ops?: TokenBucket;
}

/**
 * Token bucket for rate limiting
 */
export interface TokenBucket {
  /** Number of tokens to add per refill */
  size: number;
  /** Number of tokens available at start */
  one_time_burst?: number;
  /** Refill time in milliseconds */
  refill_time: number;
}

/**
 * Machine configuration
 */
export interface MachineConfig {
  /** Number of vCPUs */
  vcpu_count: number;
  /** Memory size in MiB */
  mem_size_mib: number;
  /** Enable SMT (hyperthreading) */
  smt?: boolean;
  /** CPU template: None, C3, T2, T2S, T2CL, T2A */
  cpu_template?: "None" | "C3" | "T2" | "T2S" | "T2CL" | "T2A";
  /** Enable memory ballooning */
  track_dirty_pages?: boolean;
}

/**
 * Vsock device configuration
 */
export interface Vsock {
  /** Guest CID (must be > 2) */
  guest_cid: number;
  /** Path to the Unix domain socket on the host */
  uds_path: string;
}

/**
 * Logger configuration
 */
export interface Logger {
  /** Path to the log file */
  log_path: string;
  /** Log level: Error, Warning, Info, Debug */
  level?: "Error" | "Warning" | "Info" | "Debug";
  /** Show log level in output */
  show_level?: boolean;
  /** Show log origin (file:line) */
  show_log_origin?: boolean;
}

/**
 * Metrics configuration
 */
export interface Metrics {
  /** Path to the metrics file */
  metrics_path: string;
}

/**
 * MMDS (MicroVM Metadata Service) configuration
 */
export interface MmdsConfig {
  /** MMDS version: V1 or V2 */
  version?: "V1" | "V2";
  /** Network interfaces that can access MMDS */
  network_interfaces: string[];
  /** IPv4 address for MMDS (default: 169.254.169.254) */
  ipv4_address?: string;
}

/**
 * Instance action request
 */
export interface InstanceActionInfo {
  /** Action type */
  action_type: "FlushMetrics" | "InstanceStart" | "SendCtrlAltDel";
}

/**
 * Instance information response
 */
export interface InstanceInfo {
  /** Instance ID */
  id: string;
  /** Instance state */
  state: "Not started" | "Running" | "Paused";
  /** VMM version */
  vmm_version: string;
  /** Application name */
  app_name: string;
}

/**
 * Snapshot create parameters
 */
export interface SnapshotCreateParams {
  /** Path to store the snapshot */
  snapshot_path: string;
  /** Path to store the memory file */
  mem_file_path: string;
  /** Snapshot type: Full or Diff */
  snapshot_type?: "Full" | "Diff";
  /** Version for snapshot format */
  version?: string;
}

/**
 * Snapshot load parameters
 */
export interface SnapshotLoadParams {
  /** Path to the snapshot file */
  snapshot_path: string;
  /** Path to the memory file */
  mem_file_path: string;
  /** Enable diff snapshots */
  enable_diff_snapshots?: boolean;
  /** Resume VM after loading */
  resume_vm?: boolean;
}

/**
 * Balloon device configuration
 */
export interface Balloon {
  /** Target balloon size in MiB */
  amount_mib: number;
  /** Enable deflate on OOM */
  deflate_on_oom?: boolean;
  /** Enable statistics (requires stats_polling_interval_s) */
  stats_polling_interval_s?: number;
}

/**
 * Balloon statistics
 */
export interface BalloonStats {
  /** Target balloon size in MiB */
  target_mib: number;
  /** Actual balloon size in MiB */
  actual_mib: number;
  /** Target pages */
  target_pages: number;
  /** Actual pages */
  actual_pages: number;
  /** Swap in (from disk to memory) */
  swap_in?: number;
  /** Swap out (from memory to disk) */
  swap_out?: number;
  /** Major faults */
  major_faults?: number;
  /** Minor faults */
  minor_faults?: number;
  /** Free memory in the guest */
  free_memory?: number;
  /** Total memory in the guest */
  total_memory?: number;
  /** Available memory */
  available_memory?: number;
  /** Disk caches */
  disk_caches?: number;
  /** Huge pages total */
  hugetlb_allocations?: number;
  /** Huge pages failures */
  hugetlb_failures?: number;
}

/**
 * Entropy device configuration
 */
export interface EntropyDevice {
  /** Rate limiter (optional) */
  rate_limiter?: RateLimiter;
}

/**
 * Full VM configuration for creating a microVM
 */
export interface VmConfig {
  boot_source: BootSource;
  drives: Drive[];
  machine_config: MachineConfig;
  network_interfaces?: NetworkInterface[];
  vsock?: Vsock;
  logger?: Logger;
  metrics?: Metrics;
  mmds_config?: MmdsConfig;
  balloon?: Balloon;
  entropy?: EntropyDevice;
}

/**
 * Error response from Firecracker API
 */
export interface FirecrackerError {
  fault_message: string;
}
