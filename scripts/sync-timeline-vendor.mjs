import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
const dir='public/vendor/vis-timeline';
await mkdir(dir,{recursive:true});
for(const [source,target] of [['standalone/umd/vis-timeline-graph2d.min.js','vis-timeline.min.js'],['styles/vis-timeline-graph2d.min.css','vis-timeline.min.css'],['LICENSE.MIT.txt','LICENSE.MIT.txt']]) {
  await copyFile('node_modules/vis-timeline/'+source,dir+'/'+target);
}
const pkg=JSON.parse(await readFile('node_modules/vis-timeline/package.json','utf8'));
await writeFile(dir+'/NOTICE.txt',`vis-timeline ${pkg.version}\nSource: https://github.com/visjs/vis-timeline\nLicense: MIT (selected from Apache-2.0 OR MIT). See LICENSE.MIT.txt and notices embedded in the standalone bundle.\nReproduce: npm ci && node scripts/sync-timeline-vendor.mjs\n`);
