# main 1

The look MONEVA had before the redesign, kept so it can be restored whole.

Taken 2026-09-05, from the build that carries the liquid glass bottom bar, the
loading skeletons, the guided tour and the MONEVA launcher icons.

## What is here

- `src/` — the whole web source: pages, components, styles, assets.
- `android-res/` — the Android resources, including the launcher icons and the
  splash and status bar colours.
- `index.html` — the shell, which carries the font links.

## Restoring it

Copy the two directories back over the live ones:

    cp -r design-snapshots/main-1/src/.          apps/web/src/
    cp -r design-snapshots/main-1/android-res/.  apps/web/android/app/src/main/res/
    cp     design-snapshots/main-1/index.html    apps/web/index.html

Then rebuild: `npm run build && npx cap sync android`.

Nothing outside these paths is part of the look, so a restore does not touch the
API client, the stores, or anything on the server.
