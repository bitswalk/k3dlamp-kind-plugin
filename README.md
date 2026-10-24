# k3dlamp kind plugin

A Headlamp Desktop plugin that creates and deletes [kind](https://kind.sigs.k8s.io) clusters. It is built for [k3dlamp](https://github.com/bitswalk/k3dlamp), next to the [k3d plugin](https://github.com/bitswalk/k3dlamp-k3d-plugin), for machines where kind is the easier install: Ubuntu, for one, packages both Docker and kind.

The plugin checks that kind works, lists its clusters, creates clusters, and deletes them. kind adds each new cluster to the default kubeconfig. Headlamp watches that file, so the cluster appears in the cluster list as `kind-<name>`. kind also makes the new cluster the kubeconfig's current context, and has no option not to.

Its **kind** page, also reached from **Add Cluster → Providers → kind**, creates a cluster two ways:

- **Add cluster** creates a cluster with one control-plane node, which also runs workloads, named `local-aio`, or `local-aio-2` and so on if that name is taken.
- **Custom cluster**, at the top right, opens an editor on that same config. Edit it or upload a kind config file, then click **Create**. The editor keeps the draft until a create from it succeeds, so **Edit config** on a failure reopens it as it was.

## Requirements

**This plugin works only in a Headlamp desktop build whose `app-build-manifest.json` grants it three kind commands, and that passes standard input to them.** Headlamp runs a plugin's local commands only when the build's manifest grants them, and stock Headlamp releases grant none to this plugin. Installed there, the plugin shows a notice listing the missing grants instead of the kind page.

To use the plugin in your own build, you need:

- Headlamp v0.46.0 or later, the first release with the `runCommands` manifest field, with k3dlamp's [`0004-run-command-input.patch`](https://github.com/bitswalk/k3dlamp/blob/main/patches/0004-run-command-input.patch). Stock Headlamp passes a plugin's command no standard input, which is how the plugin hands kind a cluster config. k3dlamp 0.4.0 and later carry it.
- Docker and [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) on the `PATH` the app starts with.
- A `runCommands` policy that names this plugin and grants the commands in [`command-grants.json`](command-grants.json).

| Invocation | Match | Plugin use |
| --- | --- | --- |
| `kind get clusters` | Exact | Checks that kind runs and lists clusters |
| `kind create cluster --config - --wait 5m` | Exact | Creates a cluster from the config it sends on standard input, and waits up to five minutes for its control plane |
| `kind delete cluster --name <name>` | Prefix | Deletes a cluster |

For the plugin installed from Artifact Hub, the policy is:

```json
{
  "environment": "production",
  "pluginLocation": "user",
  "plugins": [
    {
      "bundleName": "k3dlamp-kind-plugin",
      "packageName": "@bitswalk/headlamp-kind",
      "artifactHubPackage": "bitswalk/k3dlamp-kind-plugin"
    }
  ],
  "commands": [
    { "tool": "kind", "args": ["get", "clusters"] },
    { "tool": "kind", "args": ["create", "cluster", "--config", "-", "--wait", "5m"] },
    { "tool": "kind", "args": ["delete", "cluster", "--name"], "allowTrailingArgs": true }
  ]
}
```

Headlamp's [command capabilities guide](https://headlamp.dev/docs/latest/development/plugins/command-capabilities) recommends also pinning `artifactHubPackageId` and `artifactHubRepositoryId`. A policy for the `user` location can't pre-approve commands, so Headlamp asks for consent the first time each of the three runs, and remembers the answer.

The plugin sends `create` exactly as granted, with the config on standard input, and appends exactly one argument to `delete`: a cluster name, checked against kind's naming rules, so `--all` and extra flags can't get through. A config is any text up to 1 MiB, the most k3dlamp passes; kind checks it. `src/kind.ts` is the only module that runs a command, and a unit test fails if its argv drifts from `command-grants.json`.

The plugin builds against `@kinvolk/headlamp-plugin` 0.14.0, which predates the `PluginRunCommand` type, so `kind.ts` declares that type itself.

## What it reports

| Situation | What the kind page shows |
| --- | --- |
| The build grants no kind command, or this is a browser deployment | A notice listing the three grants it needs |
| `kind` isn't on `PATH` | "kind is not installed, or not on the PATH this app was started with." |
| The build can't pass standard input, such as k3dlamp before 0.4.0 | "This app can't pass a config to kind. Update k3dlamp to 0.4.0 or later." |
| Consent was denied | "The kind command was denied in the consent prompt, and the app keeps that choice." |
| kind fails, for example Docker is down | kind's own stderr |

## Develop

Requires Node 22.

```bash
npm ci
npm test && npm run tsc && npm run lint
```

To try a change in a k3dlamp development run, build the plugin into k3dlamp's development plugin directory. Set `K3DLAMP_PLUGINS_DIR` if yours differs from `~/.config/k3dlamp/plugins`.

```bash
npm run dev:install
```

`overrides` in `package.json` moves build and test tooling that `@kinvolk/headlamp-plugin` pulls in past known vulnerabilities, as in the k3d plugin; its README explains each one.

## Release

1. Bump `version` in `package.json` and commit.
2. Push a matching tag, for example `v0.1.0`.

The release workflow checks the tag against `package.json`, runs the checks, and publishes `bitswalk-headlamp-kind-<version>.tar.gz` with a `SHA256SUMS` file. It then commits `artifacthub/<version>/`, the Artifact Hub metadata that points at that archive, to `main`. Artifact Hub picks the new version up on its next scan, usually within 30 minutes.

Before the first release, add this repository to Artifact Hub as a Headlamp plugins repository whose URL is this repository's `artifacthub` directory, then put its repository ID in [`artifacthub/artifacthub-repo.yml`](artifacthub/artifacthub-repo.yml).
