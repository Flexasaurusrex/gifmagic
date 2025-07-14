// api/convert-to-gif.js - Vercel Serverless Function
const { spawn } = require('child_process');
const { promises: fs } = require('fs');
const path = require('path');
const os = require('os');

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    console.log('🎬 GIF conversion request received');

    try {
        // Parse multipart form data
        const formData = await parseMultipartForm(req);
        
        if (!formData.video) {
            return res.status(400).json({ 
                error: 'No video file uploaded',
                message: 'Please upload a WebM, MP4, or MOV file'
            });
        }

        const { video, quality = 'balanced' } = formData;
        
        // Quality settings
        let scale, fps, colors;
        switch(quality) {
            case 'fast':
                scale = '320:-1';
                fps = 8;
                colors = 128;
                break;
            case 'balanced':
                scale = '480:-1';
                fps = 10;
                colors = 256;
                break;
            case 'high':
                scale = '600:-1';
                fps = 12;
                colors = 256;
                break;
            default:
                scale = '480:-1';
                fps = 10;
                colors = 256;
        }

        console.log(`🔄 Converting with quality: ${quality} (${scale}, ${fps}fps)`);

        // Create temporary files
        const tmpDir = os.tmpdir();
        const inputPath = path.join(tmpDir, `input-${Date.now()}.webm`);
        const palettePath = path.join(tmpDir, `palette-${Date.now()}.png`);
        const outputPath = path.join(tmpDir, `output-${Date.now()}.gif`);

        // Write uploaded video to temp file
        await fs.writeFile(inputPath, video);
        console.log('📁 Video written to temp file');

        // Step 1: Generate palette
        await runFFmpeg([
            '-i', inputPath,
            '-vf', `fps=${fps},scale=${scale}:flags=lanczos,palettegen=max_colors=${colors}`,
            '-y', palettePath
        ]);
        console.log('🎨 Palette generated');

        // Step 2: Create GIF with palette
        await runFFmpeg([
            '-i', inputPath,
            '-i', palettePath,
            '-filter_complex', `[0:v]fps=${fps},scale=${scale}:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3`,
            '-y', outputPath
        ]);
        console.log('🎉 GIF created successfully');

        // Read the created GIF
        const gifBuffer = await fs.readFile(outputPath);
        console.log(`📊 GIF size: ${(gifBuffer.length / 1024 / 1024).toFixed(2)}MB`);

        // Clean up temp files
        await Promise.all([
            fs.unlink(inputPath).catch(console.warn),
            fs.unlink(palettePath).catch(console.warn),
            fs.unlink(outputPath).catch(console.warn)
        ]);
        console.log('🧹 Temp files cleaned up');

        // Return the GIF
        res.setHeader('Content-Type', 'image/gif');
        res.setHeader('Content-Disposition', 'attachment; filename="animation.gif"');
        res.setHeader('Content-Length', gifBuffer.length);
        res.send(gifBuffer);

    } catch (error) {
        console.error('💥 Conversion failed:', error);
        res.status(500).json({ 
            error: 'Conversion failed',
            message: error.message
        });
    }
}

// Helper function to run ffmpeg
function runFFmpeg(args) {
    return new Promise((resolve, reject) => {
        console.log('🔧 FFmpeg command:', 'ffmpeg', args.join(' '));
        
        const ffmpeg = spawn('ffmpeg', args, {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let stderr = '';
        
        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg failed with code ${code}: ${stderr}`));
            }
        });

        ffmpeg.on('error', (err) => {
            reject(new Error(`FFmpeg spawn error: ${err.message}`));
        });
    });
}

// Simple multipart form parser for Vercel
async function parseMultipartForm(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        
        req.on('data', chunk => {
            chunks.push(chunk);
        });
        
        req.on('end', () => {
            try {
                const buffer = Buffer.concat(chunks);
                const boundary = getBoundary(req.headers['content-type']);
                const parts = parseMultipart(buffer, boundary);
                
                const formData = {};
                parts.forEach(part => {
                    if (part.name === 'video') {
                        formData.video = part.data;
                    } else if (part.name === 'quality') {
                        formData.quality = part.data.toString();
                    }
                });
                
                resolve(formData);
            } catch (error) {
                reject(error);
            }
        });
        
        req.on('error', reject);
    });
}

function getBoundary(contentType) {
    const match = contentType.match(/boundary=([^;]+)/);
    return match ? match[1] : null;
}

function parseMultipart(buffer, boundary) {
    const parts = [];
    const boundaryBuffer = Buffer.from('--' + boundary);
    
    let start = 0;
    while (true) {
        const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
        if (boundaryIndex === -1) break;
        
        const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
        if (nextBoundaryIndex === -1) break;
        
        const partData = buffer.slice(boundaryIndex + boundaryBuffer.length, nextBoundaryIndex);
        const headerEndIndex = partData.indexOf('\r\n\r\n');
        
        if (headerEndIndex !== -1) {
            const headers = partData.slice(0, headerEndIndex).toString();
            const data = partData.slice(headerEndIndex + 4, partData.length - 2);
            
            const nameMatch = headers.match(/name="([^"]+)"/);
            if (nameMatch) {
                parts.push({
                    name: nameMatch[1],
                    data: data
                });
            }
        }
        
        start = nextBoundaryIndex;
    }
    
    return parts;
}
