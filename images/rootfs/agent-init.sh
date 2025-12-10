#!/sbin/openrc-run

name="zephyr-agent"
description="Zephyr CI Agent"
command="/usr/local/bin/zephyr-agent"
command_background="yes"
pidfile="/run/${name}.pid"
output_log="/var/log/${name}.log"
error_log="/var/log/${name}.err"

depend() {
    need net
    after firewall
}

start_pre() {
    # Wait for network to be ready
    local i=0
    while [ $i -lt 30 ]; do
        if ip addr show eth0 | grep -q "inet "; then
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
    ewarn "Network not ready after 30 seconds"
    return 0
}
