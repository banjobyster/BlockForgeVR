# `portfolio/` folder

This folder makes the repo appear as a **featured card** on my portfolio site
([banjobyster.github.io](https://banjobyster.github.io)). The site reads these
files directly from GitHub at page load — nothing here affects the project's own
code or build. Remove this folder and the repo drops to the compact
"More on GitHub" list instead.

| File           | Purpose                                                        |
| -------------- | ------------------------------------------------------------- |
| `project.json` | The card's data (see field reference below).                  |
| `cover.png`    | The screenshot shown on the card (any web image format works).|

## `project.json` fields

All fields are optional except `title`. The site uses a subset today; the rest
are here so projects are ready as the site grows.

### Identity
| Field         | Type     | Notes |
| ------------- | -------- | ----- |
| `title`       | string   | Display name. Defaults to the repo name if omitted. |
| `tagline`     | string   | Short one-liner under the title. |
| `description` | string   | Longer blurb. Wrap `**words**` to show them in the accent color. |
| `highlights`  | string[] | Bullet points of key features / achievements. |

### Classification
| Field      | Type     | Notes |
| ---------- | -------- | ----- |
| `category` | string   | e.g. `Web`, `Game`, `Machine Learning`, `Systems`, `Graphics`. |
| `tags`     | string[] | Tech stack shown as chips. |
| `status`   | string   | `wip` · `active` · `complete` · `archived`. |
| `year`     | number   | Year built (or `date` like `"2022-05"` if you prefer). |
| `role`     | string   | e.g. `Solo`, `Team of 4`, `Hackathon`. |

### Links
| Field     | Type   | Notes |
| --------- | ------ | ----- |
| `demo`    | string | Live / playable URL. |
| `repo`    | string | **Auto-derived** from the repo's GitHub URL — only set this to override. |
| `video`   | string | Demo video / YouTube link. |
| `article` | string | Blog post / write-up. |

### Media
| Field       | Type     | Notes |
| ----------- | -------- | ----- |
| `cover`     | string   | Main card image, filename in this folder. |
| `thumbnail` | string   | Optional smaller image. |
| `gallery`   | string[] | Extra screenshots (filenames in this folder). |

### Presentation
| Field      | Type    | Notes |
| ---------- | ------- | ----- |
| `order`    | number  | Ranking — **lower shows first**. Space by 10s (10, 20, 30…) so you can insert between without renumbering. |
| `featured` | boolean | Default `true`. Set `false` to keep the folder but not show a big card. |
| `pinned`   | boolean | Reserved for a future "top pick" highlight. |
| `accent`   | string  | CSS color used for the title and `**highlighted**` words. |

> `stars`, `language`, and `last updated` are **not** stored here — the site pulls
> those live from the GitHub API automatically.
