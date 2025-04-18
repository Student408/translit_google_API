const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Create dist directory if it doesn't exist
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist');
}

// Compile TypeScript files using tsc
try {
  console.log('Compiling TypeScript files...');
  execSync('npx tsc');
  console.log('TypeScript compilation completed successfully.');
} catch (error) {
  console.error('Error compiling TypeScript:', error.message);
  process.exit(1);
}

// Copy static files
const filesToCopy = [
  { from: 'manifest.json', to: 'dist/manifest.json' },
  { from: 'src/popup/popup.html', to: 'dist/popup.html' },
  { from: 'src/popup/popup.css', to: 'dist/popup.css' }
];

// Create assets directory if it doesn't exist
if (!fs.existsSync('dist/assets')) {
  fs.mkdirSync('dist/assets', { recursive: true });
}

// If assets directory exists in project root, copy its contents
if (fs.existsSync('assets')) {
  const assetFiles = fs.readdirSync('assets');
  assetFiles.forEach(file => {
    const sourcePath = path.join('assets', file);
    const destPath = path.join('dist/assets', file);
    filesToCopy.push({ from: sourcePath, to: destPath });
  });
} else {
  // Create placeholder icon files if they don't exist
  console.log('Creating placeholder icon files...');
  fs.mkdirSync('assets', { recursive: true });
  
  // Create simple 1x1 pixel PNG files as placeholders
  const iconSizes = [16, 48, 128];
  
  // Simple 1x1 transparent PNG base64 data
  const pngData = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  
  iconSizes.forEach(size => {
    const iconPath = path.join('assets', `icon${size}.png`);
    fs.writeFileSync(iconPath, pngData);
    console.log(`Created placeholder icon: ${iconPath}`);
    
    // Add to files to copy
    filesToCopy.push({
      from: iconPath,
      to: path.join('dist/assets', `icon${size}.png`)
    });
  });
}

// Copy all files
console.log('Copying files...');
filesToCopy.forEach(({ from, to }) => {
  try {
    if (fs.existsSync(from)) {
      fs.copyFileSync(from, to);
      console.log(`Copied: ${from} -> ${to}`);
    } else {
      console.warn(`Warning: File not found: ${from}`);
    }
  } catch (error) {
    console.error(`Error copying ${from} to ${to}:`, error.message);
  }
});

console.log('Build completed successfully!');
