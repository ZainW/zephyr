/**
 * Firecracker VM Manager
 *
 * Handles the full lifecycle of a Firecracker microVM:
 * - Spawning the Firecracker process
 * - Configuring the VM via API
 * - Starting/stopping the VM
 * - Cleanup
 */

import { FirecrackerClient } from "./client.ts";
import type { VmConfig, InstanceInfo } from "./types.ts";

export interface VmOptions {
  /** Unique VM identifier */
  id: string;
  /** Path to the Firecracker binary */
  firecrackerPath?: string;
  /** Directory for VM runtime files (sockets, logs) */
  runtimeDir: string;
  /** VM configuration */
  config: VmConfig;
  /** Enable debug logging */
  debug?: boolean;
}

export interface VmInstance {
  /** VM identifier */
  id: string;
  /** Firecracker API client */
  client: FirecrackerClient;
  /** Firecracker process */
  process: ReturnType<typeof Bun.spawn>;
  /** Path to the API socket */
  socketPath: string;
  /** Path to the vsock socket (if configured) */
  vsockPath?: string;
  /** VM state */
  state: "configuring" | "running" | "stopped" | "error";
}

/**
 * Wait for a file to exist (with timeout)
 */
async function waitForFile(
  path: string,
  timeoutMs: number = 5000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await Bun.file(path).exists()) {
      return true;
    }
    await Bun.sleep(50);
  }
  return false;
}

/**
 * Wait for the Firecracker API to be ready
 */
async function waitForApi(
  client: FirecrackerClient,
  timeoutMs: number = 5000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await client.getInstanceInfo();
      return true;
    } catch {
      await Bun.sleep(50);
    }
  }
  return false;
}

export class VmManager {
  private firecrackerPath: string;
  private instances: Map<string, VmInstance> = new Map();

  constructor(options: { firecrackerPath?: string } = {}) {
    this.firecrackerPath = options.firecrackerPath ?? "firecracker";
  }

  /**
   * Create and configure a new microVM
   */
  async create(options: VmOptions): Promise<VmInstance> {
    const { id, runtimeDir, config, debug } = options;

    // Ensure runtime directory exists
    await Bun.write(`${runtimeDir}/.keep`, "");

    const socketPath = `${runtimeDir}/${id}.sock`;
    const logPath = `${runtimeDir}/${id}.log`;

    // Remove existing socket if present
    try {
      await Bun.$`rm -f ${socketPath}`.quiet();
    } catch {
      // Ignore errors
    }

    // Build Firecracker command
    const args = [
      "--api-sock",
      socketPath,
      "--level",
      debug ? "Debug" : "Warning",
      "--log-path",
      logPath,
    ];

    if (debug) {
      args.push("--show-level", "--show-log-origin");
    }

    // Spawn Firecracker process
    const proc = Bun.spawn([this.firecrackerPath, ...args], {
      stdout: debug ? "inherit" : "ignore",
      stderr: debug ? "inherit" : "ignore",
      stdin: "ignore",
    });

    // Wait for socket to be created
    const socketReady = await waitForFile(socketPath, 5000);
    if (!socketReady) {
      proc.kill();
      throw new Error(`Firecracker socket not created: ${socketPath}`);
    }

    // Create API client
    const client = new FirecrackerClient({ socketPath });

    // Wait for API to be ready
    const apiReady = await waitForApi(client, 5000);
    if (!apiReady) {
      proc.kill();
      throw new Error("Firecracker API not responding");
    }

    const instance: VmInstance = {
      id,
      client,
      process: proc,
      socketPath,
      vsockPath: config.vsock?.uds_path,
      state: "configuring",
    };

    this.instances.set(id, instance);

    // Configure the VM
    await this.configure(instance, config);

    return instance;
  }

  /**
   * Configure a microVM via the API
   */
  private async configure(instance: VmInstance, config: VmConfig): Promise<void> {
    const { client } = instance;

    // Set boot source
    await client.setBootSource(config.boot_source);

    // Set machine config
    await client.setMachineConfig(config.machine_config);

    // Configure drives
    for (const drive of config.drives) {
      await client.setDrive(drive);
    }

    // Configure network interfaces
    if (config.network_interfaces) {
      for (const iface of config.network_interfaces) {
        await client.setNetworkInterface(iface);
      }
    }

    // Configure vsock
    if (config.vsock) {
      await client.setVsock(config.vsock);
    }

    // Configure logger
    if (config.logger) {
      await client.setLogger(config.logger);
    }

    // Configure metrics
    if (config.metrics) {
      await client.setMetrics(config.metrics);
    }

    // Configure MMDS
    if (config.mmds_config) {
      await client.setMmdsConfig(config.mmds_config);
    }

    // Configure balloon
    if (config.balloon) {
      await client.setBalloon(config.balloon);
    }
  }

  /**
   * Start a configured microVM
   */
  async start(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`VM not found: ${id}`);
    }

    if (instance.state !== "configuring") {
      throw new Error(`VM ${id} is not in configuring state: ${instance.state}`);
    }

    await instance.client.start();
    instance.state = "running";
  }

  /**
   * Stop a running microVM gracefully
   */
  async stop(id: string, timeoutMs: number = 10000): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      throw new Error(`VM not found: ${id}`);
    }

    if (instance.state !== "running") {
      return;
    }

    // Try graceful shutdown first
    try {
      await instance.client.sendCtrlAltDel();

      // Wait for process to exit
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        // Check if process has exited
        const exitCode = instance.process.exitCode;
        if (exitCode !== null) {
          instance.state = "stopped";
          return;
        }
        await Bun.sleep(100);
      }
    } catch {
      // Graceful shutdown failed
    }

    // Force kill
    instance.process.kill("SIGKILL");
    instance.state = "stopped";
  }

  /**
   * Destroy a microVM and clean up resources
   */
  async destroy(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) {
      return;
    }

    // Stop if running
    if (instance.state === "running") {
      await this.stop(id, 5000);
    }

    // Kill process if still alive
    if (instance.process.exitCode === null) {
      instance.process.kill("SIGKILL");
    }

    // Clean up socket
    try {
      await Bun.$`rm -f ${instance.socketPath}`.quiet();
    } catch {
      // Ignore errors
    }

    this.instances.delete(id);
  }

  /**
   * Get VM instance information
   */
  async getInfo(id: string): Promise<InstanceInfo | null> {
    const instance = this.instances.get(id);
    if (!instance) {
      return null;
    }

    try {
      return await instance.client.getInstanceInfo();
    } catch {
      return null;
    }
  }

  /**
   * Get a VM instance by ID
   */
  getInstance(id: string): VmInstance | undefined {
    return this.instances.get(id);
  }

  /**
   * List all VM instances
   */
  listInstances(): VmInstance[] {
    return Array.from(this.instances.values());
  }

  /**
   * Destroy all VMs
   */
  async destroyAll(): Promise<void> {
    const ids = Array.from(this.instances.keys());
    await Promise.all(ids.map((id) => this.destroy(id)));
  }
}
