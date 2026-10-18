// What scripts/vite-plugin-site.mjs serves as `virtual:site-data`: the
// catalogue facts the landing page's scripts need, read from
// public/catalogue.json when Vite builds the page.
declare module "virtual:site-data" {
  export interface SitePart {
    id: string;
    name: string;
    system: string;
    confidence: string;
    /** a public path ("thumbnails/gridfinity_bin.png"), or null for a part with no render */
    thumbnail: string | null;
    /** the app's link that opens this part on the Bench, relative to the site's base */
    bench: string;
  }
  const data: {
    parts: SitePart[];
    /** the catalogue entry the Library demo resizes through lib/resize.js */
    resizePart: any;
  };
  export default data;
}
