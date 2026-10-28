# Deploying the website (Dokploy)

Not published on the site. This is for the owner: how the Nabu website (nabu.aion.builders) is built and served on Dokploy.

The website is the SvelteKit app of this repository, built with `@sveltejs/adapter-node`. Most pages (docs, API reference, changelog, architecture, brand) are prerendered at build time; the rest is served by the Node server in `build/`.

## Dokploy settings

| Setting | Value |
|---|---|
| Source | the GitHub repository `aionbuilders/nabu`, branch `main` |
| Build type | **Nixpacks** (the repository has a `nixpacks.toml`; leave the build path at `/`) |
| Install command | from `nixpacks.toml`: `bun install --frozen-lockfile` |
| Build command | from `nixpacks.toml`: `bun run build` |
| Start command | from `nixpacks.toml`: `node build` |
| Container port | `3000` |
| Domain | `nabu.aion.builders`, HTTPS on, container port `3000` |
| Health check | `GET /` expecting `200` |

Leave the command fields of Dokploy empty so that `nixpacks.toml` applies. To override them in the UI, use the same three commands.

## Environment variables

Set these in the Dokploy **Environment** tab. They are read at runtime by the adapter-node server.

| Variable | Value | Why |
|---|---|---|
| `ORIGIN` | `https://nabu.aion.builders` | The public URL of the site. adapter-node uses it to build the request URL, and SvelteKit refuses cross-site form posts without it. Required behind the Dokploy proxy. |
| `PORT` | `3000` (default, also in `nixpacks.toml`) | The port the Node server listens on. It must equal the container port of the domain. |
| `HOST` | `0.0.0.0` (default, also in `nixpacks.toml`) | The address it binds to. Keep it, or the proxy cannot reach the container. |

Alternative to `ORIGIN` when the proxy sets the forwarded headers (Dokploy's Traefik does): `PROTOCOL_HEADER=x-forwarded-proto` and `HOST_HEADER=x-forwarded-host`. `ORIGIN` is simpler and is what to use here.

No secret is needed: the site has no database and calls no external API at runtime. Nothing to set at build time either.

## Versions

- **Node 22** or newer (`nodejs_22` in `nixpacks.toml`; Vite 8 and SvelteKit 3 need 20.19+ / 22.12+; the project is developed on Node 24).
- **Bun 1.x** for installing and for running the scripts (`bun.lock` is the lockfile; `--frozen-lockfile` fails the build if it is out of date).
- Both come from `nixPkgs` in `nixpacks.toml`; the `build` script calls `npm run`, which Node provides.

## What the build does

`bun run build` runs, in order:

1. `npm run api:model`: TypeDoc turns the JSDoc of `src/lib` into `src/site/api/model.json` (the API reference). **TypeDoc is a devDependency, so devDependencies must be installed at build time.** `bun install` installs them by default; do not set `--production` and do not use `NODE_ENV=production` for the install step.
2. `vite build`: the SvelteKit build, and the prerendering of the docs, API, changelog, architecture and brand pages (Shiki and marked, also devDependencies, run here).
3. `npm run prepack`: packages the library (`svelte-package`) and checks it with `publint`.

It needs nothing else: no git history, no network (all fonts are bundled from `@fontsource`), no browser. A full build takes about a minute on a developer machine; give the Dokploy builder a few minutes.

The server in `build/` still imports some packages at runtime (`svelte`, `@sveltejs/kit`, `loro-crdt`, `esm-env`), so `node_modules` must stay in the image: the nixpacks image keeps the install folder, so do not prune devDependencies after the build.

## Check by hand

```bash
bun install --frozen-lockfile
bun run build
PORT=3000 ORIGIN=http://localhost:3000 node build
# in another terminal:
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/    # 200
```

## Releasing the npm package

Unrelated to the website: the package is published from a developer machine with `bun run prepack` then `npm publish`. The website deploy never publishes anything.
