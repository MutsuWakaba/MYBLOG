const sharp = require('sharp');
const path = require('path');

const imgPath = path.join(__dirname, 'src/assets/images/avatar.jpg');
const outPath = path.join(__dirname, 'src/assets/images/avatar_cropped.jpg');

sharp(imgPath)
  .metadata()
  .then(metadata => {
    // 决定截取一个正方形，边长取宽和高中较小的值的 60%
    const size = Math.min(metadata.width, metadata.height);
    const cropSize = Math.floor(size * 0.7);
    
    // 脸部一般在中上方，所以 top 取稍微偏上的位置
    const left = Math.floor((metadata.width - cropSize) / 2);
    const top = Math.floor((metadata.height - cropSize) * 0.2); // 0.2 代表偏上
    
    return sharp(imgPath)
      .extract({ left, top, width: cropSize, height: cropSize })
      .toFile(outPath);
  })
  .then(() => {
    console.log("Crop successful");
  })
  .catch(err => {
    console.error("Crop error:", err);
  });
