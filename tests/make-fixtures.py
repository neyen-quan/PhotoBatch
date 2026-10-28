from PIL import Image,ImageCms,PngImagePlugin,ImageDraw
from pathlib import Path
import numpy as np,zipfile
p=Path(__file__).parent/'fixtures';p.mkdir(exist_ok=True)
y,x=np.mgrid[:360,:480]
im=Image.fromarray(np.stack(((x+y)%256,(2*y)%256,(3*x)%256),axis=-1).astype('uint8'))
profile=ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
m=PngImagePlugin.PngInfo();m.add_text('parameters','AI_TEST_PROMPT_1234');m.add_itxt('workflow','AI_TEST_WORKFLOW');m.add_text('Software','AI_TEST_GENERATOR');m.add_text('Comment','PRIVATE_TEST')
im.save(p/'rgb.png',pnginfo=m,icc_profile=profile,dpi=(144,144))
im.save(p/'normal.jpg',quality=93,icc_profile=profile)
im.save(p/'progressive.jpeg',quality=88,progressive=True,icc_profile=profile)
im.save(p/'plain.webp',quality=80)
rgba=im.convert('RGBA');rgba.putalpha(Image.fromarray(((x+y)%256).astype('uint8')))
rgba.save(p/'alpha.webp',lossless=True,icc_profile=profile);rgba.save(p/'alpha.png',pnginfo=m)
im.quantize(128).save(p/'palette.png',pnginfo=m,transparency=0)
Image.fromarray(((x+y)*60).astype('uint16')).save(p/'sixteen.png',pnginfo=m)
im.save(p/'animated.png',save_all=True,append_images=[im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)],duration=100,loop=0)
im.save(p/'unsupported.gif')
root=p.parents[1]
icon=Image.new('RGBA',(256,256),(0,0,0,0));d=ImageDraw.Draw(icon);d.rounded_rectangle((8,8,248,248),radius=50,fill='#142b20',outline='#6cbb8e',width=5)
for xx in (57,139):
 for yy in (57,139):d.rounded_rectangle((xx,yy,xx+60,yy+60),radius=12,fill='#9be6bb')
icon.save(root/'app/icon.png');icon.save(root/'app/icon.ico',sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
with zipfile.ZipFile(next((root/'build/cache').rglob('*linux-x64.zip'))) as z:z.extractall(root/'build/electron-linux')
(root/'build/electron-linux/electron').chmod(0o755);(root/'build/electron-linux/chrome_crashpad_handler').chmod(0o755)
