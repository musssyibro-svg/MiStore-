# Product Slide Images

Drop phone photos here using this structure:

```
assets/slides/{model-slug}/slide-1.webp   ← hero (front + back)
assets/slides/{model-slug}/slide-2.webp   ← all colors lineup
assets/slides/{model-slug}/slide-3.webp   ← front + back + side
assets/slides/{model-slug}/slide-4.webp   ← alternate angle
```

### Model folder names

| Model | Folder name |
|---|---|
| iPhone 16 Pro Max | `iphone-16-pro-max` |
| iPhone 16 Pro | `iphone-16-pro` |
| iPhone 16 Plus | `iphone-16-plus` |
| iPhone 16 | `iphone-16` |
| iPhone 15 Pro Max | `iphone-15-pro-max` |
| iPhone 15 Pro | `iphone-15-pro` |
| iPhone 15 | `iphone-15` |
| iPhone 14 Pro Max | `iphone-14-pro-max` |
| iPhone 14 Pro | `iphone-14-pro` |
| iPhone 14 | `iphone-14` |
| iPhone 13 Pro Max | `iphone-13-pro-max` |
| iPhone 13 Pro | `iphone-13-pro` |
| iPhone 13 | `iphone-13` |
| iPhone 12 Pro Max | `iphone-12-pro-max` |
| iPhone 12 Pro | `iphone-12-pro` |
| iPhone 12 | `iphone-12` |
| iPhone 11 Pro Max | `iphone-11-pro-max` |
| iPhone 11 Pro | `iphone-11-pro` |
| iPhone 11 | `iphone-11` |
| iPhone XS Max | `iphone-xs-max` |
| iPhone XR | `iphone-xr` |

### How to activate local images

Once you add WebP files for a model, open `index.html` and find `slidesFor()`.
Add the local paths to the `own` array for that model in `PHONE_IMAGES`:

```js
const PHONE_IMAGES = {
  'iPhone 16 Pro Max': [
    'assets/slides/iphone-16-pro-max/slide-1.webp',
    'assets/slides/iphone-16-pro-max/slide-2.webp',
    'assets/slides/iphone-16-pro-max/slide-3.webp',
    'assets/slides/iphone-16-pro-max/slide-4.webp',
  ],
};
```

Local paths take priority over Apple CDN images.

### How to create the WebP slides

Use Canva, Figma, or Photoshop:
- Download official press photos from apple.com/iphone
- Slide 1: front + back composite on gradient/white background
- Slide 2: all color options in a row
- Slide 3: front + back + side 3-angle view
- Slide 4: lifestyle or alternate hero angle
- Export as WebP, 800×1066 px (3:4 ratio), 80% quality
