# Photos

Real photos of the crew at work, taken on fall cleanups in October 2026, plus two **temporary stand-ins**
(public-domain / CC0 stock) for the seasons we have no photos of yet. Replace a stand-in with a real photo,
keeping the **same filename**, and nothing else needs to change.

The photos in this folder's root are cropped to a **circle** inside the logo's thin green ring, so keep the
subject in the middle of the frame: the top, bottom and corners get cropped away. Vertical (portrait) or
square both work. Aim for at least **1200 × 1600 px**, JPG. Everything here has had its EXIF data (camera,
GPS location) stripped; do the same for new photos of customers' homes
(`convert in.jpg -auto-orient -strip -resize 1200x1600 -quality 82 out.jpg`).

| File | Where it shows | Status |
| --- | --- | --- |
| `hero-leaf-blowing.jpg` | Hero, top of the page (first thing people see) | **Real**: a crew member in an orange shirt sending red maple leaves flying with a backpack blower. The crop focus is set in `components/sections/hero.tsx` (`position`). |
| `mower-lawn.jpg` | "Three seasons. One crew." section, Spring & Summer circle | Stand-in. Shoot: your mower on freshly cut grass, low angle, clean stripes if you can get them. |
| `fall-leaves-lawn.jpg` | "Three seasons. One crew." section, Fall circle | **Real**: a customer's front lawn under maple leaves, before cleanup. |
| `snow-driveway.jpg` | "Three seasons. One crew." section, Winter circle | Stand-in. Shoot: your snowblower clearing a driveway. Also handy for a winter version of the hero. |

## `work/`: the crew on the job

The strip of photos at the foot of the "Why us" section (`components/sections/why-us.tsx`). These are shown
whole at 3:4 with no circle crop, so any portrait phone photo works. The list of photos and their alt text is
`content.whyUs.gallery` in `lib/content.ts`: add a photo here, then add a line there. Six fit in one row on a
laptop; phones scroll the strip sideways.

| File | What it shows |
| --- | --- |
| `red-maples.jpg` | A crew member pushing a pile of red maple leaves across a lawn, red maples behind |
| `gold-maple-pile.jpg` | A crew member working a long pile of leaves under a gold maple at dusk |
| `blower-close.jpg` | Leaves lifting off the grass in front of the blower nozzle |
| `leaves-before.jpg` | A leaf-covered yard with a stone wall and the house behind, before cleanup |
| `crew-pair.jpg` | Two crew members with backpack blowers on a sunny front lawn |
| `crew-tree.jpg` | A crew member blowing leaves out from under a big oak by the sidewalk |

When picking photos, skip ones that show a readable house number, license plate, or a neighbor's yard sign.
Still nice to have: a photo of **Emmett, Kevin, and Chase together** with the equipment.

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

## Where the stand-ins came from

- `mower-lawn.jpg`: "Grass Lawnmower", StockSnap (CC0)
- `snow-driveway.jpg`: "Gotta Clear The Lane", Flickr (CC0)
