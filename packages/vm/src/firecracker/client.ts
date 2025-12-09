/**
 * Firecracker HTTP API Client
 *
 * Communicates with Firecracker via Unix socket using Bun's native fetch.
 * API docs: https://github.com/firecracker-microvm/firecracker/blob/main/src/api_server/swagger/firecracker.yaml
 */

import type {
  BootSource,
  Drive,
  NetworkInterface,
  MachineConfig,
  Vsock,
  Logger,
  Metrics,
  MmdsConfig,
  InstanceActionInfo,
  InstanceInfo,
  SnapshotCreateParams,
  SnapshotLoadParams,
  Balloon,
  BalloonStats,
  FirecrackerError,
} from "./types.ts";

export interface FirecrackerClientOptions {
  /** Path to the Firecracker Unix socket */
  socketPath: string;
}

export class FirecrackerClient {
  private socketPath: string;

  constructor(options: FirecrackerClientOptions) {
    this.socketPath = options.socketPath;
  }

  /**
   * Make a request to the Firecracker API via Unix socket
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `http://localhost${path}`;

    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      // @ts-expect-error - Bun supports unix socket in fetch
      unix: this.socketPath,
    });

    if (!response.ok) {
      const error = (await response.json()) as FirecrackerError;
      throw new Error(
        `Firecracker API error (${response.status}): ${error.fault_message}`
      );
    }

    // Some endpoints return empty body (204 No Content)
    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text) {
      return undefined as T;
    }

    return JSON.parse(text) as T;
  }

  // =========================================================================
  // Instance Management
  // =========================================================================

  /**
   * Get instance information
   */
  async getInstanceInfo(): Promise<InstanceInfo> {
    return this.request<InstanceInfo>("GET", "/");
  }

  /**
   * Perform an instance action (start, send ctrl+alt+del, flush metrics)
   */
  async instanceAction(action: InstanceActionInfo): Promise<void> {
    await this.request<void>("PUT", "/actions", action);
  }

  /**
   * Start the microVM
   */
  async start(): Promise<void> {
    await this.instanceAction({ action_type: "InstanceStart" });
  }

  /**
   * Send Ctrl+Alt+Del to the guest (graceful shutdown)
   */
  async sendCtrlAltDel(): Promise<void> {
    await this.instanceAction({ action_type: "SendCtrlAltDel" });
  }

  /**
   * Flush metrics to the metrics file
   */
  async flushMetrics(): Promise<void> {
    await this.instanceAction({ action_type: "FlushMetrics" });
  }

  // =========================================================================
  // Boot Source Configuration
  // =========================================================================

  /**
   * Set the boot source (kernel image, boot args, initrd)
   */
  async setBootSource(bootSource: BootSource): Promise<void> {
    await this.request<void>("PUT", "/boot-source", bootSource);
  }

  // =========================================================================
  // Drive Configuration
  // =========================================================================

  /**
   * Add or update a drive
   */
  async setDrive(drive: Drive): Promise<void> {
    await this.request<void>("PUT", `/drives/${drive.drive_id}`, drive);
  }

  /**
   * Update a drive (partial update)
   */
  async patchDrive(
    driveId: string,
    update: Partial<Drive>
  ): Promise<void> {
    await this.request<void>("PATCH", `/drives/${driveId}`, update);
  }

  // =========================================================================
  // Network Interface Configuration
  // =========================================================================

  /**
   * Add or update a network interface
   */
  async setNetworkInterface(iface: NetworkInterface): Promise<void> {
    await this.request<void>(
      "PUT",
      `/network-interfaces/${iface.iface_id}`,
      iface
    );
  }

  /**
   * Update a network interface (partial update)
   */
  async patchNetworkInterface(
    ifaceId: string,
    update: Partial<NetworkInterface>
  ): Promise<void> {
    await this.request<void>("PATCH", `/network-interfaces/${ifaceId}`, update);
  }

  // =========================================================================
  // Machine Configuration
  // =========================================================================

  /**
   * Get the machine configuration
   */
  async getMachineConfig(): Promise<MachineConfig> {
    return this.request<MachineConfig>("GET", "/machine-config");
  }

  /**
   * Set the machine configuration (vCPUs, memory)
   */
  async setMachineConfig(config: MachineConfig): Promise<void> {
    await this.request<void>("PUT", "/machine-config", config);
  }

  /**
   * Update the machine configuration (partial update)
   */
  async patchMachineConfig(update: Partial<MachineConfig>): Promise<void> {
    await this.request<void>("PATCH", "/machine-config", update);
  }

  // =========================================================================
  // Vsock Configuration
  // =========================================================================

  /**
   * Set the vsock device configuration
   */
  async setVsock(vsock: Vsock): Promise<void> {
    await this.request<void>("PUT", "/vsock", vsock);
  }

  // =========================================================================
  // Logger Configuration
  // =========================================================================

  /**
   * Set the logger configuration
   */
  async setLogger(logger: Logger): Promise<void> {
    await this.request<void>("PUT", "/logger", logger);
  }

  // =========================================================================
  // Metrics Configuration
  // =========================================================================

  /**
   * Set the metrics configuration
   */
  async setMetrics(metrics: Metrics): Promise<void> {
    await this.request<void>("PUT", "/metrics", metrics);
  }

  // =========================================================================
  // MMDS (Metadata Service) Configuration
  // =========================================================================

  /**
   * Set the MMDS configuration
   */
  async setMmdsConfig(config: MmdsConfig): Promise<void> {
    await this.request<void>("PUT", "/mmds/config", config);
  }

  /**
   * Get MMDS data
   */
  async getMmdsData(): Promise<unknown> {
    return this.request<unknown>("GET", "/mmds");
  }

  /**
   * Set MMDS data (replace all)
   */
  async setMmdsData(data: unknown): Promise<void> {
    await this.request<void>("PUT", "/mmds", data);
  }

  /**
   * Update MMDS data (merge)
   */
  async patchMmdsData(data: unknown): Promise<void> {
    await this.request<void>("PATCH", "/mmds", data);
  }

  // =========================================================================
  // Snapshot Management
  // =========================================================================

  /**
   * Create a snapshot of the microVM
   */
  async createSnapshot(params: SnapshotCreateParams): Promise<void> {
    await this.request<void>("PUT", "/snapshot/create", params);
  }

  /**
   * Load a snapshot
   */
  async loadSnapshot(params: SnapshotLoadParams): Promise<void> {
    await this.request<void>("PUT", "/snapshot/load", params);
  }

  // =========================================================================
  // Balloon Device
  // =========================================================================

  /**
   * Set the balloon device configuration
   */
  async setBalloon(balloon: Balloon): Promise<void> {
    await this.request<void>("PUT", "/balloon", balloon);
  }

  /**
   * Update the balloon device (change target size)
   */
  async patchBalloon(update: Partial<Balloon>): Promise<void> {
    await this.request<void>("PATCH", "/balloon", update);
  }

  /**
   * Get balloon statistics
   */
  async getBalloonStats(): Promise<BalloonStats> {
    return this.request<BalloonStats>("GET", "/balloon/statistics");
  }

  // =========================================================================
  // VM State Management
  // =========================================================================

  /**
   * Pause the microVM
   */
  async pause(): Promise<void> {
    await this.request<void>("PATCH", "/vm", { state: "Paused" });
  }

  /**
   * Resume the microVM
   */
  async resume(): Promise<void> {
    await this.request<void>("PATCH", "/vm", { state: "Resumed" });
  }

  // =========================================================================
  // Version Information
  // =========================================================================

  /**
   * Get Firecracker version information
   */
  async getVersion(): Promise<{ firecracker_version: string; api_version: string }> {
    return this.request("GET", "/version");
  }
}
