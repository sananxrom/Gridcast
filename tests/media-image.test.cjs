const test=require('node:test');
const assert=require('node:assert/strict');
const {deflateSync}=require('node:zlib');
const {existsSync}=require('node:fs');
// ffprobe-static currently bundles x86_64 under darwin/arm64; use the native local decoder when present.
if(!process.env.GC_FFPROBE_PATH && process.platform==='darwin' && existsSync('/opt/homebrew/bin/ffprobe'))process.env.GC_FFPROBE_PATH='/opt/homebrew/bin/ffprobe';
const {inspectImage,validateImageContainer,MAX_IMAGE_BYTES}=require('./load-lib.cjs')('media');
function chunk(type,data=Buffer.alloc(0)) {
 const name=Buffer.from(type), payload=Buffer.concat([name,data]);let crc=0xffffffff;
 for(const byte of payload){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
 const header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,payload,tail]);
}
function png(width=32,height=24) {
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND')]);
}
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYyLjI4LjEwMQD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABNAAEBAAAAAAAAAAAAAAAAAAAABgEBAQEAAAAAAAAAAAAAAAAAAAYHEAEAAAAAAAAAAAAAAAAAAAAAEQEAAAAAAAAAAAAAAAAAAAAA/8AAEQgAGAAgAwEiAAIRAAMRAP/aAAwDAQACEQMRAD8AiwEm38AAAAAB/9k=','base64');
const webp=Buffer.from('UklGRhQCAABXRUJQVlA4WAoAAAAgAAAAHwAAFwAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggJgAAANACAJ0BKiAAGAA+bTSWR6QjIiEoCACADYlpAAA9o6AA/vucwAAA','base64');
for(const [ext,bytes]of [['png',png()],['jpg',jpeg],['webp',webp]])test(`static ${ext} decoded with measured dimensions and no invented duration`,async()=>{
 const result=await inspectImage(bytes,ext);assert.equal(result.width,32);assert.equal(result.height,24);assert.equal(result.media_type,'image');assert.equal(result.metadata_source,'server_image');assert.equal(result.duration_s,undefined);
});
test('image MIME mismatch, oversize, truncation and corrupt data are rejected',async()=>{
 assert.throws(()=>validateImageContainer(png(),'jpg'),/contents/);assert.throws(()=>validateImageContainer(Buffer.alloc(MAX_IMAGE_BYTES+1),'png'),/10 MB/);
 assert.throws(()=>validateImageContainer(png().subarray(0,-3),'png'),/contents/);assert.throws(()=>validateImageContainer(Buffer.concat([webp,Buffer.from([1])]),'webp'),/contents/);
 const corrupt=png();corrupt[45]^=255;await assert.rejects(inspectImage(corrupt,'png'));await assert.rejects(inspectImage(png(8,8),'png'),/dimensions/);
});
test('APNG animation and WebP animation are rejected before frame processing',()=>{
 const input=png(),apng=Buffer.concat([input.subarray(0,33),chunk('acTL',Buffer.alloc(8)),input.subarray(33)]);
 assert.throws(()=>validateImageContainer(apng,'png'),/Animated/);
 const animated=Buffer.from(webp);animated[20]|=2;assert.throws(()=>validateImageContainer(animated,'webp'),/Animated/);
});
