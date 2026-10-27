# Photos

The hero, mowing and fall photos are the crew's own (October 2026), cropped square and stripped of
all metadata (phone photos carry the GPS location of the property). The snow photo is still a stock
stand-in. To swap any photo, replace the file, keeping the **same filename**. Nothing else needs to
change, apart from the image's description (`alt`) in `lib/content.ts`.

Every photo is cropped to a **circle** inside the logo's thin green ring, so keep the subject in the middle
of the frame: the top, bottom and corners get cropped away. Square works best; a vertical (portrait)
photo is centered. Aim for at least **1200 × 1200 px**, JPG. Keep yard signs, school or team logos and
house numbers out of the shot. The current crops are smaller (585 to 936 px) because the copies we were
sent were compressed by the messaging app; the full-size originals off the phone would look sharper,
the hero most of all.

| File | Where it shows | What to shoot |
| --- | --- | --- |
| `hero-leaf-blowing.jpg` | Hero, top of the page (first thing people see) | Real: a crew member blowing leaves under fall trees. |
| `mower-lawn.jpg` | "Three seasons. One crew." section, Spring & Summer circle | Real: mowing stripes into a front lawn. |
| `fall-leaves-lawn.jpg` | "Three seasons. One crew." section, Fall circle | Real: two of the crew clearing leaves toward the curb. |
| `snow-driveway.jpg` | "Three seasons. One crew." section, Winter circle | **Still stock.** Shoot your snowblower clearing a driveway or walk this winter. |

Nice to have (not wired in yet): a photo of **Emmett, Kevin, and Chase together** with the equipment.
A real crew photo builds more trust than anything else on the page.

## Logo

The badge is the 2026 minimalist version: deep forest green on white, with a maple leaf, grass, and a
snowflake for the three seasons. The original artwork (on white) is kept at `assets/logo-source-2026.webp`;
the earlier full-color badge is `assets/logo-source.jpg`. From the new source we cut:

- `public/logo.png`: transparent, for light backgrounds. Header, login, admin, crew, and search-engine data
- `public/logo-light.png`: the same badge in one cream color, for the forest-green panels (the home page's closing section)
- `assets/og/logo-og.png`: a ~520px copy for the social share image (see the main README for why it's small)
- `app/icon.png`: browser tab icon, on a rounded cream plate so it shows up on dark tab strips
- `app/apple-icon.png` and `public/icons/icon-*.png`: home-screen icons, on the paper background
  (`icon-maskable-512.png` keeps the badge inside the safe circle Android crops to)

If the logo ever changes, replace those files (or ask for them to be regenerated from a new source).

## Where the stand-in came from

- `snow-driveway.jpg`: "Gotta Clear The Lane", Flickr (CC0)
