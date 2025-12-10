// Background removal utility using @tugrul/rembg (local, free, open-source)
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

let BackgroundRemover = null;
let ort = null;
let sharp = null;
let session = null;

/**
 * Initialize the background remover (lazy load on first use)
 */
async function initialize() {
  if (BackgroundRemover && session) {
    return; // Already initialized
  }

  try {
    console.log('[backgroundRemover] Initializing @tugrul/rembg...');

    // Dynamic imports
    BackgroundRemover = (await import('@tugrul/rembg')).default;
    ort = (await import('onnxruntime-node')).default;
    sharp = (await import('sharp')).default;

    // Create ONNX inference session
    // The model file should be in node_modules/@tugrul/rembg/models/
    const modelPath = require.resolve('@tugrul/rembg/models/u2net_human_seg.onnx');
    session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'] });

    console.log('[backgroundRemover] Initialization complete!');
  } catch (err) {
    console.error('[backgroundRemover] Initialization failed:', err.message);
    throw new Error(`Failed to initialize background remover: ${err.message}`);
  }
}

/**
 * Remove background from an image using @tugrul/rembg
 * @param {Buffer|string} imageInput - Image buffer or URL
 * @returns {Promise<Buffer>} - PNG buffer with transparent background
 */
async function removeBackground(imageInput) {
  try {
    // Initialize if needed
    await initialize();

    let imageData = imageInput;

    // If input is a URL, fetch it first
    if (typeof imageInput === 'string' && imageInput.startsWith('http')) {
      console.log('[backgroundRemover] Fetching image from URL...');
      const response = await fetch(imageInput);
      if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
      imageData = Buffer.from(await response.arrayBuffer());
    }

    // Ensure we have a buffer
    if (!Buffer.isBuffer(imageData)) {
      throw new Error('Invalid image input: must be Buffer or URL string');
    }

    console.log('[backgroundRemover] Processing image with @tugrul/rembg...');

    // Create remover instance with normalization values (ImageNet standard)
    const remover = new BackgroundRemover(
      session,
      [0.485, 0.456, 0.406], // RGB means
      [0.229, 0.224, 0.225]  // RGB standard deviations
    );

    // Remove background - sharp() handles both buffers and paths
    const result = await remover.mask(sharp(imageData));

    // Convert to PNG buffer
    const outputBuffer = await result.png().toBuffer();

    if (!Buffer.isBuffer(outputBuffer)) {
      throw new Error('Background removal did not return a valid buffer');
    }

    console.log('[backgroundRemover] Successfully removed background');
    return outputBuffer;
  } catch (err) {
    console.error('[backgroundRemover] Error:', err.message);

    // Provide helpful error messages
    if (err.message.includes('Cannot find module') || err.message.includes('not found')) {
      throw new Error('Rembg dependencies not installed. Run: npm install @tugrul/rembg');
    }

    if (err.message.includes('is not a function')) {
      throw new Error('Rembg API error: Background remover initialization failed');
    }

    throw new Error(`Background removal failed: ${err.message}`);
  }
}

module.exports = {
  removeBackground,
};
