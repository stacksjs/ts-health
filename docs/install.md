# Install

Installing `ts-health` is easy. Simply pull it in via your package manager of choice, or download the binary directly.

## Package Managers

Choose your package manager of choice:

::: code-group

```sh [npm]
npm install ts-health

# or, install globally via
npm i -g ts-health
```

```sh [bun]
bun install ts-health

# or, install globally via
bun add --global ts-health
```

```sh [pnpm]
pnpm add ts-health

# or, install globally via
pnpm add --global ts-health
```

```sh [yarn]
yarn add ts-health

# or, install globally via
yarn global add ts-health
```

:::

Read more about how to use it in the [Usage](./usage.md) section of the documentation.

## Binaries

Choose the binary that matches your platform and architecture:

::: code-group

```sh [macOS (arm64)]
# Download the binary
curl -L https://github.com/stacksjs/ts-health/releases/download/v0.0.0/health-darwin-arm64 -o health

# Make it executable
chmod +x health

# Move it to your PATH
mv health /usr/local/bin/health
```

```sh [macOS (x64)]
# Download the binary
curl -L https://github.com/stacksjs/ts-health/releases/download/v0.0.0/health-darwin-x64 -o health

# Make it executable
chmod +x health

# Move it to your PATH
mv health /usr/local/bin/health
```

```sh [Linux (arm64)]
# Download the binary
curl -L https://github.com/stacksjs/ts-health/releases/download/v0.0.0/health-linux-arm64 -o health

# Make it executable
chmod +x health

# Move it to your PATH
mv health /usr/local/bin/health
```

```sh [Linux (x64)]
# Download the binary
curl -L https://github.com/stacksjs/ts-health/releases/download/v0.0.0/health-linux-x64 -o health

# Make it executable
chmod +x health

# Move it to your PATH
mv health /usr/local/bin/health
```

```sh [Windows (x64)]
# Download the binary
curl -L https://github.com/stacksjs/ts-health/releases/download/v0.0.0/health-windows-x64.exe -o health.exe

# Move it to your PATH (adjust the path as needed)
move health.exe C:\Windows\System32\health.exe
```

:::

::: tip
You can also find the `health` binaries in GitHub [releases](https://github.com/stacksjs/ts-health/releases).
:::
