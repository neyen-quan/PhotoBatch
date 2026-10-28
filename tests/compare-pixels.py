from pathlib import Path
from PIL import Image,ImageOps
import numpy as np
p=Path(__file__).parent;out=Path((p/'last-test-dir.txt').read_text())
for f in ['rgb.png','normal.jpg','progressive.jpeg','plain.webp','alpha.webp','alpha.png','palette.png','sixteen.png']:
 a=Image.open(p/'fixtures'/f);b=Image.open(out/f)
 assert a.size==b.size and a.mode==b.mode
 assert np.array_equal(np.asarray(a),np.asarray(b)),f
 assert np.array_equal(np.asarray(ImageOps.exif_transpose(a)),np.asarray(ImageOps.exif_transpose(b))),f
 assert a.info.get('icc_profile')==b.info.get('icc_profile'),f
 print(f,'PASS: pixels, orientation and ICC identical')
