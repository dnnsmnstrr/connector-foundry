// Fetches the thumbnail of every video in the published guides into
// docs/img/videos/<id>.webp, where build-docs.mjs looks for it. They are
// committed, like the gallery renders in docs/img/: the guides show our
// own copy, so reading one sends nothing to YouTube until someone presses
// play. Run it after adding a video to a guide (a unit test fails until
// the thumbnail is there):
//
//   node scripts/video-thumbnails.mjs
//
// An existing file is kept; delete it to fetch it again.
import fs from "node:fs";
import path from "node:path";
import { DOC_GROUPS, DOCS_SOURCE, VIDEO_THUMBS, guideVideos } from "./build-docs.mjs";

// Largest first. YouTube has no maxresdefault for some older or smaller
// videos and answers 404 for it; sddefault and hqdefault are 4:3 with the
// picture letterboxed in, which the play box's object-fit crops away.
const SIZES = ["maxresdefault", "sddefault", "hqdefault"];

async function fetchThumbnail(id) {
  for (const size of SIZES) {
    const response = await fetch(`https://i.ytimg.com/vi_webp/${id}/${size}.webp`);
    if (response.ok && response.headers.get("content-type") === "image/webp")
      return Buffer.from(await response.arrayBuffer());
  }
  throw new Error(`no thumbnail for video ${id}`);
}

const ids = new Set(
  DOC_GROUPS.flatMap((group) => group.docs).flatMap((doc) =>
    guideVideos(fs.readFileSync(path.join(DOCS_SOURCE, doc.file), "utf8")),
  ),
);
fs.mkdirSync(VIDEO_THUMBS, { recursive: true });
for (const id of ids) {
  const file = path.join(VIDEO_THUMBS, `${id}.webp`);
  if (fs.existsSync(file)) continue;
  const image = await fetchThumbnail(id);
  fs.writeFileSync(file, image);
  console.log(
    `video-thumbnails: ${path.relative(process.cwd(), file)} (${Math.round(image.length / 1024)} KB)`,
  );
}
