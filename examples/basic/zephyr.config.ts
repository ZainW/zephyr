import { defineConfig } from "../../packages/config/src/index.ts";

export default defineConfig({
  project: {
    name: "basic",
  },

  pipelines: [
    {
      name: "ci",
      triggers: [
        { type: "push", branches: ["main"] },
        { type: "pull_request" },
      ],
      jobs: [
        {
          name: "hello",
          runner: { image: "ubuntu-22.04" },
          steps: [
            {
              type: "run",
              name: "Print hello",
              run: "echo 'Hello from Zephyr!'",
            },
            {
              type: "run",
              name: "Show environment",
              run: "echo \"CI=$CI\" && echo \"ZEPHYR=$ZEPHYR\"",
            },
            {
              type: "run",
              name: "List files",
              run: "ls -la",
            },
          ],
        },
      ],
    },
  ],
});
