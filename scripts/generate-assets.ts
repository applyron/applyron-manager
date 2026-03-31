import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Rocket } from 'lucide-react';
import sharp from 'sharp';
import icongen from 'icon-gen';
import path from 'path';
import fs from 'fs';

const IMAGES_DIR = path.join(process.cwd(), 'images');
const SOURCE_IMAGE_CANDIDATES = [
  path.join(process.cwd(), 'logo.png'),
  path.join(process.cwd(), 'logo_no_bg.png'),
  path.join(process.cwd(), 'images', 'logo-source.png'),
  path.join(process.cwd(), 'logo.jpg'),
  path.join(process.cwd(), 'logo.jpeg'),
];

// Colors
const BACKGROUND_COLOR = '#0f172a'; // slate-900 / primary
const ICON_COLOR = '#f8fafc'; // slate-50 / primary-foreground
const ICON_SIZE = 1024;
const PADDING = 0.12; // 12% padding for raster logos

async function buildFallbackIconPngBuffer() {
  const iconSize = ICON_SIZE * (1 - PADDING * 2);
  const padding = ICON_SIZE * PADDING;

  const iconSvg = renderToStaticMarkup(
    React.createElement(Rocket, {
      size: iconSize,
      color: ICON_COLOR,
      strokeWidth: 1.5,
    }),
  );

  const fullSvg = `
    <svg width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 ${ICON_SIZE} ${ICON_SIZE}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${ICON_SIZE}" height="${ICON_SIZE}" fill="${BACKGROUND_COLOR}" />
      <g transform="translate(${padding}, ${padding})">
        ${iconSvg}
      </g>
    </svg>
  `;

  return sharp(Buffer.from(fullSvg)).png().toBuffer();
}

function getSourceImagePath() {
  return SOURCE_IMAGE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function buildRasterIconPngBuffer(sourceImagePath: string) {
  const targetSize = Math.round(ICON_SIZE * (1 - PADDING * 2));
  const renderedLogo = await sharp(sourceImagePath)
    .trim()
    .resize({
      width: targetSize,
      height: targetSize,
      fit: 'contain',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: ICON_SIZE,
      height: ICON_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: renderedLogo, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function buildTrayPngBuffer(sourceImagePath: string | null) {
  const trayCanvasSize = 64;
  const trayTargetSize = 40;

  if (!sourceImagePath) {
    const trayIconSvg = renderToStaticMarkup(
      React.createElement(Rocket, {
        size: 24,
        color: ICON_COLOR,
        strokeWidth: 2,
      }),
    );
    return sharp(Buffer.from(trayIconSvg)).png().toBuffer();
  }

  const renderedLogo = await sharp(sourceImagePath)
    .trim()
    .resize({
      width: trayTargetSize,
      height: trayTargetSize,
      fit: 'contain',
      withoutEnlargement: false,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: trayCanvasSize,
      height: trayCanvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: renderedLogo, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function generate() {
  console.log('Generating assets...');
  const sourceImagePath = getSourceImagePath();
  console.log(
    sourceImagePath
      ? `Using source image: ${sourceImagePath}`
      : 'No raster logo source found, using fallback rocket icon.',
  );

  const pngBuffer = sourceImagePath
    ? await buildRasterIconPngBuffer(sourceImagePath)
    : await buildFallbackIconPngBuffer();

  const iconPngPath = path.join(IMAGES_DIR, 'icon.png');
  await sharp(pngBuffer).toFile(iconPngPath);
  console.log(`Generated ${iconPngPath}`);

  // 3. Generate ICO and ICNS using icon-gen
  // icon-gen takes the png directory or file and outputs to destination

  // Create a temporary directory for input if needed, but icon-gen works with a file path usually?
  // Checking icon-gen docs or usage. commonly: icongen(input, destination, options)
  // Input can be a path to a png image.

  // Clean up old directories and files
  const itemsToClean = [
    'android',
    'ios',
    'icon.iconset',
    'icon_master_squircle.png',
    'storealogo.png',
    'tray-icon.png', // incorrectly named
    // Clean up "Square" logos as they appear unused
    'Square30x30Logo.png',
    'Square44x44Logo.png',
    'Square71x71Logo.png',
    'Square89x89Logo.png',
    'Square107x107Logo.png',
    'Square142x142Logo.png',
    'Square150x150Logo.png',
    'Square284x284Logo.png',
    'Square310x310Logo.png',
    'StoreLogo.png',
  ]; // checking casing or existence
  for (const item of itemsToClean) {
    const itemPath = path.join(IMAGES_DIR, item);
    if (fs.existsSync(itemPath)) {
      fs.rmSync(itemPath, { recursive: true, force: true });
      console.log(`Removed old item: ${itemPath}`);
    }
  }

  const options = {
    report: true,
    ico: {
      name: 'icon',
      sizes: [16, 24, 32, 48, 64, 128, 256],
    },
    icns: {
      name: 'icon',
      sizes: [16, 32, 64, 128, 256, 512, 1024],
    },
    favicon: {
      name: 'favicon-',
      pngSizes: [32, 57, 72, 96, 120, 128, 144, 152, 195, 228],
      icoSizes: [16, 24, 32, 48, 64],
    },
  };

  await icongen(iconPngPath, IMAGES_DIR, options);
  console.log('Generated ICO, ICNS, and Favicon files');

  // Generate standard PNGs only
  const standardSizes = [
    { name: '32x32.png', size: 32 },
    { name: '64x64.png', size: 64 },
    { name: '128x128.png', size: 128 },
    { name: '128x128@2x.png', size: 256 },
  ];

  for (const { name, size } of standardSizes) {
    await sharp(pngBuffer).resize(size, size).toFile(path.join(IMAGES_DIR, name));
    console.log(`Generated ${name}`);
  }

  const trayPngPath = path.join(IMAGES_DIR, 'tray.png');
  const trayPngBuffer = await buildTrayPngBuffer(sourceImagePath);
  await sharp(trayPngBuffer).png().toFile(trayPngPath);
  console.log('Generated tray.png');

  // Sync to src/assets
  const SRC_ASSETS_DIR = path.join(process.cwd(), 'src', 'assets');
  if (fs.existsSync(SRC_ASSETS_DIR)) {
    fs.copyFileSync(iconPngPath, path.join(SRC_ASSETS_DIR, 'icon.png'));
    fs.copyFileSync(trayPngPath, path.join(SRC_ASSETS_DIR, 'tray.png'));
    console.log('Synced icon.png and tray.png to src/assets/');
  }
}

generate().catch(console.error);
