// Derive title/favicon assets without stretching or changing installable icons.
import {readFile,writeFile} from 'node:fs/promises';
import {launchBrowser} from '../tests/browser/cdp-browser.mjs';
const source=await readFile(new URL('../assets/branding/book-mark-transparent.png',import.meta.url));
const browser=await launchBrowser();
try {
 const result=await browser.evaluate(`(async()=>{const im=new Image();im.src='data:image/png;base64,${source.toString('base64')}';await im.decode();const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);const p=x.getImageData(0,0,c.width,c.height).data;let left=c.width,top=c.height,right=0,bottom=0;for(let y=0;y<c.height;y++)for(let a=0;a<c.width;a++)if(p[(y*c.width+a)*4+3]>100){left=Math.min(left,a);right=Math.max(right,a);top=Math.min(top,y);bottom=Math.max(bottom,y);}const w=right-left+1,h=bottom-top+1;const out=document.createElement('canvas');out.width=out.height=512;const scale=480/Math.max(w,h);out.getContext('2d').drawImage(im,left,top,w,h,(512-w*scale)/2,(512-h*scale)/2,w*scale,h*scale);return {png:out.toDataURL('image/png').split(',')[1],ratio:w/h,width:w,height:h};})()`);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" preserveAspectRatio="xMidYMid meet"><image width="512" height="512" href="data:image/png;base64,${result.png}"/></svg>\n`;
 for(const name of ['favicon.svg','home-books-icon.svg'])await writeFile(new URL('../public/'+name,import.meta.url),svg);
 await writeFile(new URL('../assets/branding/title-mark-geometry.json',import.meta.url),JSON.stringify({source:'book-mark-transparent.png',objectWidth:result.width,objectHeight:result.height,aspectRatio:result.ratio,scaling:'uniform, contain'},null,2)+'\n');
 console.log('Transparent title/favicon generated; preserved aspect ratio:',result.ratio);
}finally{await browser.close();}
