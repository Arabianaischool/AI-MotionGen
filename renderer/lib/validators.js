/**
 * Input validation utilities
 */

const fs = require('fs');
const path = require('path');

/**
 * Validate that a TSX file exists and is readable
 * @param {string} filePath - Path to validate
 * @throws {Error} If validation fails
 */
function validateTsxFile(filePath) {
  // Check file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  // Check extension
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.tsx') {
    throw new Error(`Invalid file type: ${ext}. Expected .tsx file.`);
  }

  // Check readable
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch (e) {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  // Check for compositionConfig export
  const content = fs.readFileSync(filePath, 'utf-8');
  if (!content.includes('compositionConfig')) {
    throw new Error(
      'File does not contain a compositionConfig export.\n' +
      'Your TSX file must export a compositionConfig object.'
    );
  }

  // Check for component export
  if (!content.includes('export default') && !content.match(/export\s+(const|function)\s+[A-Z]/)) {
    throw new Error(
      'File does not export a React component.\n' +
      'Your TSX file must have a default export or named component export.'
    );
  }

  return true;
}

/**
 * Validate output path
 * @param {string} outputPath - Path to validate
 * @throws {Error} If validation fails
 */
function validateOutputPath(outputPath) {
  const dir = path.dirname(outputPath);

  // Check directory exists
  if (!fs.existsSync(dir)) {
    throw new Error(`Output directory does not exist: ${dir}`);
  }

  // Check extension
  const ext = path.extname(outputPath).toLowerCase();
  if (ext !== '.mp4') {
    throw new Error(`Invalid output extension: ${ext}. Expected .mp4`);
  }

  return true;
}

module.exports = {
  validateTsxFile,
  validateOutputPath,
};
