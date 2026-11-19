//! Pure image transforms of the OCR variations (the robustness measure of `ocr-check --variations`). Each function maps an
//! RGBA8 image to a new one: no I/O, no clock, no global randomness (the noise takes a seed). The images live in memory only
//! and are dropped after they are read; nothing here writes a pixel anywhere.
use d2rmm_agent_core::ports::Rgba;

/// The aspect of the maintainer's screenshots (1920x1033): the "scale" family keeps it.
const BASE_WIDTH: u64 = 1920;
const BASE_HEIGHT: u64 = 1033;

/// One transform, as the catalogue lists it and a variation applies it.
#[derive(Debug, Clone, PartialEq)]
pub enum Transform {
    /// Resize to this height, the width following the 1920:1033 aspect.
    ScaleToHeight(u32),
    /// Resize to exactly this size.
    Resize {
        width: u32,
        height: u32,
    },
    /// Crop the centre to the aspect `w:h`.
    CropAspect {
        w: u32,
        h: u32,
    },
    /// Pad with black, centred, to the aspect `w:h`.
    PadAspect {
        w: u32,
        h: u32,
    },
    Gamma(f32),
    Brightness(f32),
    Contrast(f32),
    Saturation(f32),
    /// Positive warms (more red, less blue), negative cools.
    Temperature(f32),
    Blur(f32),
    Unsharp {
        sigma: f32,
        amount: f32,
    },
    Jpeg(u8),
    Noise {
        sigma: f32,
        seed: u64,
    },
    Rgb565,
    Shift {
        dx: i32,
        dy: i32,
    },
    CropEdges {
        top: u32,
        right: u32,
        bottom: u32,
        left: u32,
    },
    AddBars {
        top: u32,
        right: u32,
        bottom: u32,
        left: u32,
    },
}

impl Transform {
    /// The image this transform makes of `image`.
    pub fn apply(&self, image: &Rgba) -> Rgba {
        match *self {
            Transform::ScaleToHeight(height) => resize(image, scaled_width(height), height),
            Transform::Resize { width, height } => resize(image, width, height),
            Transform::CropAspect { w, h } => crop_to_aspect(image, w, h),
            Transform::PadAspect { w, h } => pad_to_aspect(image, w, h),
            Transform::Gamma(gamma) => gamma_correct(image, gamma),
            Transform::Brightness(factor) => brightness(image, factor),
            Transform::Contrast(factor) => contrast(image, factor),
            Transform::Saturation(factor) => saturation(image, factor),
            Transform::Temperature(shift) => temperature(image, shift),
            Transform::Blur(sigma) => gaussian_blur(image, sigma),
            Transform::Unsharp { sigma, amount } => unsharp_mask(image, sigma, amount),
            Transform::Jpeg(quality) => jpeg_roundtrip(image, quality),
            Transform::Noise { sigma, seed } => gaussian_noise(image, sigma, seed),
            Transform::Rgb565 => quantise_rgb565(image),
            Transform::Shift { dx, dy } => shift(image, dx, dy),
            Transform::CropEdges {
                top,
                right,
                bottom,
                left,
            } => crop_edges(image, top, right, bottom, left),
            Transform::AddBars {
                top,
                right,
                bottom,
                left,
            } => add_bars(image, top, right, bottom, left),
        }
    }
}

/// The width of a 1920:1033 frame of `height`, rounded.
pub fn scaled_width(height: u32) -> u32 {
    let width = (u64::from(height) * BASE_WIDTH + BASE_HEIGHT / 2) / BASE_HEIGHT;
    u32::try_from(width).unwrap_or(u32::MAX)
}

fn blank(width: u32, height: u32, fill: [u8; 4]) -> Rgba {
    let count = width as usize * height as usize;
    let mut pixels = Vec::with_capacity(count * 4);
    for _ in 0..count {
        pixels.extend_from_slice(&fill);
    }
    Rgba {
        width,
        height,
        pixels,
    }
}

fn clamp_u8(value: f32) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}

/// Applies `f` to the red, green and blue of every pixel; alpha stays.
fn map_rgb(image: &Rgba, f: impl Fn([f32; 3]) -> [f32; 3]) -> Rgba {
    let mut out = image.clone();
    for pixel in out.pixels.as_chunks_mut::<4>().0.iter_mut() {
        let mapped = f([
            f32::from(pixel[0]),
            f32::from(pixel[1]),
            f32::from(pixel[2]),
        ]);
        pixel[0] = clamp_u8(mapped[0]);
        pixel[1] = clamp_u8(mapped[1]);
        pixel[2] = clamp_u8(mapped[2]);
    }
    out
}

// ---- resize -----------------------------------------------------------------------------------------------------------

/// For each destination index, the source indexes and weights (summing to 1). Shrinking averages the covered source span
/// (area-correct); enlarging interpolates the two nearest centres (bilinear).
fn axis_weights(source: usize, target: usize) -> Vec<Vec<(usize, f32)>> {
    let scale = source as f64 / target as f64;
    (0..target)
        .map(|index| {
            if scale > 1.0 {
                let start = index as f64 * scale;
                let end = start + scale;
                let first = start.floor() as usize;
                let last = (end.ceil() as usize).min(source);
                let mut taps = Vec::new();
                for at in first..last {
                    let overlap = end.min(at as f64 + 1.0) - start.max(at as f64);
                    if overlap > 0.0 {
                        taps.push((at, (overlap / scale) as f32));
                    }
                }
                taps
            } else {
                let centre = ((index as f64 + 0.5) * scale - 0.5).clamp(0.0, (source - 1) as f64);
                let low = centre.floor() as usize;
                let high = (low + 1).min(source - 1);
                let frac = (centre - low as f64) as f32;
                if low == high {
                    vec![(low, 1.0)]
                } else {
                    vec![(low, 1.0 - frac), (high, frac)]
                }
            }
        })
        .collect()
}

/// Resizes to `width` x `height`: area-averaging when shrinking an axis, bilinear when enlarging it. An empty source gives
/// a black image of the target size.
pub fn resize(image: &Rgba, width: u32, height: u32) -> Rgba {
    if image.width == 0 || image.height == 0 || width == 0 || height == 0 {
        return blank(width, height, [0, 0, 0, 255]);
    }
    let (sw, sh, tw, th) = (
        image.width as usize,
        image.height as usize,
        width as usize,
        height as usize,
    );
    let columns = axis_weights(sw, tw);
    let rows = axis_weights(sh, th);
    // Horizontal pass into f32 rows of the source height, then the vertical pass.
    let mut middle = vec![0f32; tw * sh * 4];
    for y in 0..sh {
        for (x, taps) in columns.iter().enumerate() {
            for channel in 0..4 {
                let mut sum = 0f32;
                for &(at, weight) in taps {
                    sum += weight * f32::from(image.pixels[(y * sw + at) * 4 + channel]);
                }
                middle[(y * tw + x) * 4 + channel] = sum;
            }
        }
    }
    let mut pixels = vec![0u8; tw * th * 4];
    for (y, taps) in rows.iter().enumerate() {
        for x in 0..tw {
            for channel in 0..4 {
                let mut sum = 0f32;
                for &(at, weight) in taps {
                    sum += weight * middle[(at * tw + x) * 4 + channel];
                }
                pixels[(y * tw + x) * 4 + channel] = clamp_u8(sum);
            }
        }
    }
    Rgba {
        width,
        height,
        pixels,
    }
}

// ---- aspect and borders -----------------------------------------------------------------------------------------------

/// Copies the rectangle at `(left, top)` of `width` x `height`; pixels outside the image are `fill`.
fn window(image: &Rgba, left: i64, top: i64, width: u32, height: u32, fill: [u8; 4]) -> Rgba {
    let mut out = blank(width, height, fill);
    for y in 0..i64::from(height) {
        let sy = y + top;
        if sy < 0 || sy >= i64::from(image.height) {
            continue;
        }
        for x in 0..i64::from(width) {
            let sx = x + left;
            if sx < 0 || sx >= i64::from(image.width) {
                continue;
            }
            let from = (sy as usize * image.width as usize + sx as usize) * 4;
            let to = (y as usize * width as usize + x as usize) * 4;
            out.pixels[to..to + 4].copy_from_slice(&image.pixels[from..from + 4]);
        }
    }
    out
}

/// Crops the centre to the aspect `w:h` (the longer side loses its edges; the shorter side stays whole).
pub fn crop_to_aspect(image: &Rgba, w: u32, h: u32) -> Rgba {
    let (iw, ih) = (u64::from(image.width), u64::from(image.height));
    let (w, h) = (u64::from(w.max(1)), u64::from(h.max(1)));
    let (cw, ch) = if iw * h > ih * w {
        (ih * w / h, ih)
    } else {
        (iw, iw * h / w)
    };
    let cw = (cw as u32).clamp(1, image.width.max(1));
    let ch = (ch as u32).clamp(1, image.height.max(1));
    let left = i64::from(image.width.saturating_sub(cw) / 2);
    let top = i64::from(image.height.saturating_sub(ch) / 2);
    window(image, left, top, cw, ch, [0, 0, 0, 255])
}

/// Pads with black, centred, until the aspect is `w:h` (the shorter side grows; the image stays whole).
pub fn pad_to_aspect(image: &Rgba, w: u32, h: u32) -> Rgba {
    let (iw, ih) = (u64::from(image.width), u64::from(image.height));
    let (w, h) = (u64::from(w.max(1)), u64::from(h.max(1)));
    let (pw, ph) = if iw * h < ih * w {
        (ih * w / h, ih)
    } else {
        (iw, iw * h / w)
    };
    let (pw, ph) = (pw as u32, ph as u32);
    let left = -i64::from(pw.saturating_sub(image.width) / 2);
    let top = -i64::from(ph.saturating_sub(image.height) / 2);
    window(image, left, top, pw, ph, [0, 0, 0, 255])
}

/// Removes this many pixels from each edge.
pub fn crop_edges(image: &Rgba, top: u32, right: u32, bottom: u32, left: u32) -> Rgba {
    let width = image.width.saturating_sub(left + right);
    let height = image.height.saturating_sub(top + bottom);
    window(
        image,
        i64::from(left),
        i64::from(top),
        width,
        height,
        [0, 0, 0, 255],
    )
}

/// Adds a dark bar of this many pixels to each edge (a window frame or title bar).
pub fn add_bars(image: &Rgba, top: u32, right: u32, bottom: u32, left: u32) -> Rgba {
    window(
        image,
        -i64::from(left),
        -i64::from(top),
        image.width + left + right,
        image.height + top + bottom,
        [16, 16, 16, 255],
    )
}

/// Moves the picture by `(dx, dy)` pixels (right and down are positive), repeating the edge pixels into the gap.
pub fn shift(image: &Rgba, dx: i32, dy: i32) -> Rgba {
    let mut out = image.clone();
    let (w, h) = (i64::from(image.width), i64::from(image.height));
    if w == 0 || h == 0 {
        return out;
    }
    for y in 0..h {
        let sy = (y - i64::from(dy)).clamp(0, h - 1);
        for x in 0..w {
            let sx = (x - i64::from(dx)).clamp(0, w - 1);
            let from = (sy * w + sx) as usize * 4;
            let to = (y * w + x) as usize * 4;
            out.pixels[to..to + 4].copy_from_slice(&image.pixels[from..from + 4]);
        }
    }
    out
}

// ---- tone and colour --------------------------------------------------------------------------------------------------

/// `out = 255 * (in / 255) ^ gamma`: above 1 darkens the mid-tones, below 1 lightens them.
pub fn gamma_correct(image: &Rgba, gamma: f32) -> Rgba {
    let table: Vec<u8> = (0..256)
        .map(|value| clamp_u8(255.0 * (value as f32 / 255.0).powf(gamma)))
        .collect();
    map_rgb(image, |p| p.map(|v| f32::from(table[v as usize])))
}

pub fn brightness(image: &Rgba, factor: f32) -> Rgba {
    map_rgb(image, |p| p.map(|v| v * factor))
}

/// Scales the distance from mid-grey (128).
pub fn contrast(image: &Rgba, factor: f32) -> Rgba {
    map_rgb(image, |p| p.map(|v| (v - 128.0) * factor + 128.0))
}

/// Scales the distance from the pixel's luma: 0 is grey, 1 is identity.
pub fn saturation(image: &Rgba, factor: f32) -> Rgba {
    map_rgb(image, |[r, g, b]| {
        let luma = 0.299 * r + 0.587 * g + 0.114 * b;
        [
            luma + (r - luma) * factor,
            luma + (g - luma) * factor,
            luma + (b - luma) * factor,
        ]
    })
}

/// Warm (`shift > 0`) raises red and lowers blue by that fraction; cool does the opposite.
pub fn temperature(image: &Rgba, shift: f32) -> Rgba {
    map_rgb(image, |[r, g, b]| [r * (1.0 + shift), g, b * (1.0 - shift)])
}

/// Keeps the top 5, 6 and 5 bits of red, green and blue and refills the low bits as a 16-bit display does.
pub fn quantise_rgb565(image: &Rgba) -> Rgba {
    let mut out = image.clone();
    for pixel in out.pixels.as_chunks_mut::<4>().0.iter_mut() {
        pixel[0] = (pixel[0] & 0xF8) | (pixel[0] >> 5);
        pixel[1] = (pixel[1] & 0xFC) | (pixel[1] >> 6);
        pixel[2] = (pixel[2] & 0xF8) | (pixel[2] >> 5);
    }
    out
}

// ---- blur and sharpen -------------------------------------------------------------------------------------------------

fn gaussian_kernel(sigma: f32) -> Vec<f32> {
    let radius = (sigma * 3.0).ceil().max(1.0) as i32;
    let mut kernel: Vec<f32> = (-radius..=radius)
        .map(|at| (-((at * at) as f32) / (2.0 * sigma * sigma)).exp())
        .collect();
    let sum: f32 = kernel.iter().sum();
    kernel.iter_mut().for_each(|weight| *weight /= sum);
    kernel
}

/// The RGB planes of the image blurred, as f32 (no rounding), with replicated edges.
fn blur_planes(image: &Rgba, sigma: f32) -> Vec<f32> {
    let (w, h) = (image.width as usize, image.height as usize);
    let kernel = gaussian_kernel(sigma);
    let radius = (kernel.len() / 2) as i64;
    let mut horizontal = vec![0f32; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            for channel in 0..3 {
                let mut sum = 0f32;
                for (tap, weight) in kernel.iter().enumerate() {
                    let at = (x as i64 + tap as i64 - radius).clamp(0, w as i64 - 1) as usize;
                    sum += weight * f32::from(image.pixels[(y * w + at) * 4 + channel]);
                }
                horizontal[(y * w + x) * 3 + channel] = sum;
            }
        }
    }
    let mut out = vec![0f32; w * h * 3];
    for y in 0..h {
        for x in 0..w {
            for channel in 0..3 {
                let mut sum = 0f32;
                for (tap, weight) in kernel.iter().enumerate() {
                    let at = (y as i64 + tap as i64 - radius).clamp(0, h as i64 - 1) as usize;
                    sum += weight * horizontal[(at * w + x) * 3 + channel];
                }
                out[(y * w + x) * 3 + channel] = sum;
            }
        }
    }
    out
}

/// A separable gaussian blur of standard deviation `sigma` pixels, edges replicated.
pub fn gaussian_blur(image: &Rgba, sigma: f32) -> Rgba {
    if image.width == 0 || image.height == 0 || sigma <= 0.0 {
        return image.clone();
    }
    let planes = blur_planes(image, sigma);
    let mut out = image.clone();
    for (index, pixel) in out.pixels.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        for channel in 0..3 {
            pixel[channel] = clamp_u8(planes[index * 3 + channel]);
        }
    }
    out
}

/// `out = in + amount * (in - blur(in))`.
pub fn unsharp_mask(image: &Rgba, sigma: f32, amount: f32) -> Rgba {
    if image.width == 0 || image.height == 0 || sigma <= 0.0 {
        return image.clone();
    }
    let planes = blur_planes(image, sigma);
    let mut out = image.clone();
    for (index, pixel) in out.pixels.as_chunks_mut::<4>().0.iter_mut().enumerate() {
        for channel in 0..3 {
            let original = f32::from(pixel[channel]);
            pixel[channel] = clamp_u8(original + amount * (original - planes[index * 3 + channel]));
        }
    }
    out
}

// ---- noise ------------------------------------------------------------------------------------------------------------

/// splitmix64: a small seeded generator, so the noise is the same on every run and no crate is needed.
pub struct SplitMix64(pub u64);

impl SplitMix64 {
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in (0, 1].
    fn unit(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64 + 1.0) / (1u64 << 53) as f64
    }

    /// A standard normal draw pair (Box-Muller).
    fn normal_pair(&mut self) -> (f64, f64) {
        let radius = (-2.0 * self.unit().ln()).sqrt();
        let angle = std::f64::consts::TAU * self.unit();
        (radius * angle.cos(), radius * angle.sin())
    }
}

/// Adds independent gaussian noise of standard deviation `sigma` (in 0..255 levels) to every colour channel.
pub fn gaussian_noise(image: &Rgba, sigma: f32, seed: u64) -> Rgba {
    let mut rng = SplitMix64(seed);
    let mut out = image.clone();
    let mut spare: Option<f64> = None;
    let mut draw = move || match spare.take() {
        Some(value) => value,
        None => {
            let (a, b) = rng.normal_pair();
            spare = Some(b);
            a
        }
    };
    for pixel in out.pixels.as_chunks_mut::<4>().0.iter_mut() {
        for channel in pixel.iter_mut().take(3) {
            *channel = clamp_u8(f32::from(*channel) + sigma * draw() as f32);
        }
    }
    out
}

// ---- JPEG-like compression --------------------------------------------------------------------------------------------

const LUMA_TABLE: [u8; 64] = [
    16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
    14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
    92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
];

const CHROMA_TABLE: [u8; 64] = [
    17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99,
    47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
    99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
];

/// The quantisation table of the standard, scaled for `quality` 1..=100 (the libjpeg rule).
fn scaled_table(base: &[u8; 64], quality: u8) -> [f32; 64] {
    let quality = u32::from(quality.clamp(1, 100));
    let scale = if quality < 50 {
        5000 / quality
    } else {
        200 - quality * 2
    };
    let mut table = [1f32; 64];
    for (out, &value) in table.iter_mut().zip(base) {
        *out = ((u32::from(value) * scale + 50) / 100).clamp(1, 255) as f32;
    }
    table
}

/// The 8-point DCT-II basis, `basis[k][n] = c(k) * cos((2n + 1) k pi / 16)`.
fn dct_basis() -> [[f32; 8]; 8] {
    let mut basis = [[0f32; 8]; 8];
    for (k, row) in basis.iter_mut().enumerate() {
        let scale = if k == 0 {
            (1.0f64 / 8.0).sqrt()
        } else {
            (2.0f64 / 8.0).sqrt()
        };
        for (n, cell) in row.iter_mut().enumerate() {
            *cell = (scale * (((2 * n + 1) * k) as f64 * std::f64::consts::PI / 16.0).cos()) as f32;
        }
    }
    basis
}

/// Quantises one plane (edges replicated up to a multiple of 8) through the DCT and back.
fn quantise_plane(
    plane: &[f32],
    width: usize,
    height: usize,
    table: &[f32; 64],
    basis: &[[f32; 8]; 8],
) -> Vec<f32> {
    let mut out = vec![0f32; width * height];
    let sample = |x: usize, y: usize| plane[y.min(height - 1) * width + x.min(width - 1)];
    for by in (0..height).step_by(8) {
        for bx in (0..width).step_by(8) {
            let mut block = [[0f32; 8]; 8];
            for (y, row) in block.iter_mut().enumerate() {
                for (x, cell) in row.iter_mut().enumerate() {
                    *cell = sample(bx + x, by + y) - 128.0;
                }
            }
            // coefficients = B * block * B^T
            let mut tmp = [[0f32; 8]; 8];
            for k in 0..8 {
                for x in 0..8 {
                    tmp[k][x] = (0..8).map(|n| basis[k][n] * block[n][x]).sum();
                }
            }
            let mut coefficients = [0f32; 64];
            for k in 0..8 {
                for l in 0..8 {
                    let value: f32 = (0..8).map(|n| tmp[k][n] * basis[l][n]).sum();
                    let step = table[k * 8 + l];
                    coefficients[k * 8 + l] = (value / step).round() * step;
                }
            }
            // block = B^T * coefficients * B
            let mut back = [[0f32; 8]; 8];
            for n in 0..8 {
                for l in 0..8 {
                    back[n][l] = (0..8).map(|k| basis[k][n] * coefficients[k * 8 + l]).sum();
                }
            }
            for (y, back_row) in back.iter().enumerate() {
                for x in 0..8 {
                    let (px, py) = (bx + x, by + y);
                    if px < width && py < height {
                        let value: f32 = back_row
                            .iter()
                            .zip(basis.iter())
                            .map(|(coefficient, row)| coefficient * row[x])
                            .sum();
                        out[py * width + px] = value + 128.0;
                    }
                }
            }
        }
    }
    out
}

/// A JPEG round trip in memory: BT.601 YCbCr, chroma subsampled 4:2:0, 8x8 DCT, quantisation by the standard tables scaled
/// for `quality` (1..=100), then the inverse. No byte stream is written; only the loss is reproduced.
pub fn jpeg_roundtrip(image: &Rgba, quality: u8) -> Rgba {
    let (w, h) = (image.width as usize, image.height as usize);
    if w == 0 || h == 0 {
        return image.clone();
    }
    let mut luma = vec![0f32; w * h];
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    let mut cb_full = vec![0f32; w * h];
    let mut cr_full = vec![0f32; w * h];
    for (index, pixel) in image.pixels.as_chunks::<4>().0.iter().enumerate() {
        let (r, g, b) = (
            f32::from(pixel[0]),
            f32::from(pixel[1]),
            f32::from(pixel[2]),
        );
        luma[index] = 0.299 * r + 0.587 * g + 0.114 * b;
        cb_full[index] = 128.0 - 0.168_736 * r - 0.331_264 * g + 0.5 * b;
        cr_full[index] = 128.0 + 0.5 * r - 0.418_688 * g - 0.081_312 * b;
    }
    let subsample = |plane: &[f32]| {
        let mut small = vec![0f32; cw * ch];
        for y in 0..ch {
            for x in 0..cw {
                let mut sum = 0f32;
                for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                    sum += plane[(y * 2 + dy).min(h - 1) * w + (x * 2 + dx).min(w - 1)];
                }
                small[y * cw + x] = sum / 4.0;
            }
        }
        small
    };
    let (cb_small, cr_small) = (subsample(&cb_full), subsample(&cr_full));
    let basis = dct_basis();
    let luma_table = scaled_table(&LUMA_TABLE, quality);
    let chroma_table = scaled_table(&CHROMA_TABLE, quality);
    let luma = quantise_plane(&luma, w, h, &luma_table, &basis);
    let cb = quantise_plane(&cb_small, cw, ch, &chroma_table, &basis);
    let cr = quantise_plane(&cr_small, cw, ch, &chroma_table, &basis);
    let mut out = image.clone();
    for y in 0..h {
        for x in 0..w {
            let index = y * w + x;
            let chroma = (y / 2) * cw + x / 2;
            let (yy, bb, rr) = (luma[index], cb[chroma] - 128.0, cr[chroma] - 128.0);
            let pixel = &mut out.pixels[index * 4..index * 4 + 3];
            pixel[0] = clamp_u8(yy + 1.402 * rr);
            pixel[1] = clamp_u8(yy - 0.344_136 * bb - 0.714_136 * rr);
            pixel[2] = clamp_u8(yy + 1.772 * bb);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(width: u32, height: u32, f: impl Fn(u32, u32) -> [u8; 4]) -> Rgba {
        let mut pixels = Vec::new();
        for y in 0..height {
            for x in 0..width {
                pixels.extend_from_slice(&f(x, y));
            }
        }
        Rgba {
            width,
            height,
            pixels,
        }
    }

    fn grey(width: u32, height: u32, value: u8) -> Rgba {
        image(width, height, |_, _| [value, value, value, 255])
    }

    fn at(image: &Rgba, x: u32, y: u32) -> [u8; 4] {
        let i = (y * image.width + x) as usize * 4;
        [
            image.pixels[i],
            image.pixels[i + 1],
            image.pixels[i + 2],
            image.pixels[i + 3],
        ]
    }

    fn gradient(width: u32, height: u32) -> Rgba {
        image(width, height, |x, y| {
            [
                (x * 13 % 256) as u8,
                (y * 29 % 256) as u8,
                ((x + y) * 7 % 256) as u8,
                255,
            ]
        })
    }

    #[test]
    fn scaled_width_keeps_the_screenshot_aspect() {
        assert_eq!(scaled_width(1033), 1920);
        // 1080 * 1920 / 1033 = 2007.4
        assert_eq!(scaled_width(1080), 2007);
        assert_eq!(scaled_width(720), 1338);
    }

    #[test]
    fn resize_to_the_same_size_is_the_identity_and_sizes_are_exact() {
        let source = gradient(9, 7);
        assert_eq!(resize(&source, 9, 7), source);
        let bigger = resize(&source, 20, 15);
        assert_eq!(
            (bigger.width, bigger.height, bigger.pixels.len()),
            (20, 15, 20 * 15 * 4)
        );
        let smaller = resize(&source, 4, 3);
        assert_eq!((smaller.width, smaller.height), (4, 3));
    }

    #[test]
    fn a_flat_image_stays_flat_when_resized() {
        let flat = grey(10, 10, 77);
        for (w, h) in [(3, 3), (25, 17), (10, 5)] {
            let out = resize(&flat, w, h);
            assert!(
                out.pixels
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .all(|p| *p == [77, 77, 77, 255]),
                "{w}x{h}"
            );
        }
    }

    #[test]
    fn shrinking_by_two_averages_the_2x2_blocks() {
        let source = image(2, 2, |x, y| {
            let v = [0u8, 100, 200, 100][(y * 2 + x) as usize];
            [v, v, v, 255]
        });
        // (0 + 100 + 200 + 100) / 4 = 100
        assert_eq!(at(&resize(&source, 1, 1), 0, 0), [100, 100, 100, 255]);
    }

    #[test]
    fn enlarging_interpolates_between_the_centres() {
        let source = image(2, 1, |x, _| {
            if x == 0 {
                [0, 0, 0, 255]
            } else {
                [200, 200, 200, 255]
            }
        });
        let out = resize(&source, 4, 1);
        // Centres at -0.25 (clamped to 0), 0.25, 0.75, 1.25 (clamped to 1): 0, 50, 150, 200.
        let row: Vec<u8> = (0..4).map(|x| at(&out, x, 0)[0]).collect();
        assert_eq!(row, [0, 50, 150, 200]);
    }

    #[test]
    fn an_empty_source_resizes_to_black() {
        let empty = Rgba {
            width: 0,
            height: 0,
            pixels: Vec::new(),
        };
        let out = resize(&empty, 2, 2);
        assert_eq!(out.pixels.len(), 16);
    }

    #[test]
    fn crop_to_aspect_cuts_the_wide_side_and_pad_grows_the_narrow_one() {
        let wide = grey(40, 10, 9);
        let cropped = crop_to_aspect(&wide, 4, 3);
        assert_eq!((cropped.width, cropped.height), (13, 10));
        let narrow = grey(12, 12, 9);
        let padded = pad_to_aspect(&narrow, 21, 9);
        assert_eq!((padded.width, padded.height), (28, 12));
        assert_eq!(at(&padded, 0, 0), [0, 0, 0, 255], "bars are black");
        assert_eq!(
            at(&padded, 14, 6),
            [9, 9, 9, 255],
            "the picture sits in the middle"
        );
        let again = crop_to_aspect(&padded, 1, 1);
        assert_eq!((again.width, again.height), (12, 12));
    }

    #[test]
    fn edges_are_removed_and_bars_added_by_the_amounts() {
        let source = gradient(10, 6);
        let cut = crop_edges(&source, 2, 1, 0, 3);
        assert_eq!((cut.width, cut.height), (6, 4));
        assert_eq!(at(&cut, 0, 0), at(&source, 3, 2));
        let barred = add_bars(&source, 3, 0, 1, 2);
        assert_eq!((barred.width, barred.height), (12, 10));
        assert_eq!(at(&barred, 0, 0), [16, 16, 16, 255]);
        assert_eq!(at(&barred, 2, 3), at(&source, 0, 0));
        assert_eq!(crop_edges(&source, 0, 0, 0, 0), source);
    }

    #[test]
    fn shift_moves_the_picture_and_repeats_the_edge() {
        let source = image(4, 1, |x, _| [x as u8 * 10, 0, 0, 255]);
        let right = shift(&source, 2, 0);
        let row: Vec<u8> = (0..4).map(|x| at(&right, x, 0)[0]).collect();
        assert_eq!(row, [0, 0, 0, 10]);
        let left = shift(&source, -1, 0);
        let row: Vec<u8> = (0..4).map(|x| at(&left, x, 0)[0]).collect();
        assert_eq!(row, [10, 20, 30, 30]);
        assert_eq!(shift(&source, 0, 0), source);
        assert_eq!(
            shift(&source, 0, 3).pixels,
            source.pixels,
            "one row: the edge repeats"
        );
    }

    #[test]
    fn tone_transforms_have_their_identities_and_hand_values() {
        let source = gradient(5, 5);
        assert_eq!(gamma_correct(&source, 1.0), source);
        assert_eq!(brightness(&source, 1.0), source);
        assert_eq!(contrast(&source, 1.0), source);
        assert_eq!(temperature(&source, 0.0), source);
        let mid = image(1, 1, |_, _| [100, 150, 200, 255]);
        assert_eq!(at(&brightness(&mid, 0.5), 0, 0), [50, 75, 100, 255]);
        // (100 - 128) * 2 + 128 = 72, (150 - 128) * 2 + 128 = 172, (200 - 128) * 2 + 128 = 272 -> 255
        assert_eq!(at(&contrast(&mid, 2.0), 0, 0), [72, 172, 255, 255]);
        let ends = image(2, 1, |x, _| {
            if x == 0 {
                [0, 0, 0, 255]
            } else {
                [255, 255, 255, 255]
            }
        });
        assert_eq!(gamma_correct(&ends, 1.6), ends);
        // 255 * (128 / 255) ^ 2 = 64.25 -> 64
        assert_eq!(at(&gamma_correct(&grey(1, 1, 128), 2.0), 0, 0)[0], 64);
        assert_eq!(at(&temperature(&mid, 0.1), 0, 0), [110, 150, 180, 255]);
    }

    #[test]
    fn saturation_one_is_identity_and_zero_is_grey_by_the_luma() {
        let mid = image(1, 1, |_, _| [100, 150, 200, 255]);
        assert_eq!(saturation(&mid, 1.0), mid);
        // 0.299 * 100 + 0.587 * 150 + 0.114 * 200 = 140.75
        assert_eq!(at(&saturation(&mid, 0.0), 0, 0), [141, 141, 141, 255]);
    }

    #[test]
    fn rgb565_keeps_five_six_five_bits() {
        let source = image(1, 1, |_, _| [0x12, 0x34, 0x56, 255]);
        // r: 0x10 | 0x00, g: 0x34 | 0x00, b: 0x50 | 0x02
        assert_eq!(at(&quantise_rgb565(&source), 0, 0), [0x10, 0x34, 0x52, 255]);
        let white = grey(1, 1, 255);
        assert_eq!(quantise_rgb565(&white), white);
    }

    #[test]
    fn blur_keeps_flat_images_and_spreads_an_impulse() {
        let flat = grey(9, 9, 120);
        assert_eq!(gaussian_blur(&flat, 1.5), flat);
        let impulse = image(9, 9, |x, y| {
            if (x, y) == (4, 4) {
                [255, 255, 255, 255]
            } else {
                [0, 0, 0, 255]
            }
        });
        let blurred = gaussian_blur(&impulse, 1.0);
        let centre = at(&blurred, 4, 4)[0];
        assert!(centre > 0 && centre < 255, "{centre}");
        assert!(at(&blurred, 5, 4)[0] > 0);
        assert_eq!(at(&blurred, 5, 4), at(&blurred, 3, 4), "symmetric");
        assert_eq!(gaussian_blur(&impulse, 0.0), impulse);
    }

    #[test]
    fn unsharp_keeps_flat_images_and_raises_an_edge() {
        let flat = grey(8, 8, 90);
        assert_eq!(unsharp_mask(&flat, 1.0, 2.0), flat);
        let edge = image(8, 1, |x, _| {
            if x < 4 {
                [100, 100, 100, 255]
            } else {
                [150, 150, 150, 255]
            }
        });
        let sharp = unsharp_mask(&edge, 1.0, 2.0);
        assert!(
            at(&sharp, 3, 0)[0] < 100,
            "the dark side of an edge gets darker"
        );
        assert!(at(&sharp, 4, 0)[0] > 150, "the light side gets lighter");
    }

    #[test]
    fn noise_is_seeded_and_leaves_alpha_alone() {
        let source = grey(16, 16, 128);
        let a = gaussian_noise(&source, 8.0, 7);
        let b = gaussian_noise(&source, 8.0, 7);
        let c = gaussian_noise(&source, 8.0, 8);
        assert_eq!(a, b, "same seed, same noise");
        assert_ne!(a, c, "another seed, other noise");
        assert_ne!(a, source);
        assert!(a.pixels.as_chunks::<4>().0.iter().all(|p| p[3] == 255));
        assert_eq!(gaussian_noise(&source, 0.0, 7), source);
        let mean: f64 = a
            .pixels
            .as_chunks::<4>()
            .0
            .iter()
            .map(|p| f64::from(p[0]))
            .sum::<f64>()
            / 256.0;
        assert!((mean - 128.0).abs() < 3.0, "{mean}");
    }

    #[test]
    fn splitmix_matches_its_reference_first_output() {
        // The reference splitmix64 stream seeded with 0 starts 0xE220A8397B1DCDAF.
        assert_eq!(SplitMix64(0).next_u64(), 0xE220_A839_7B1D_CDAF);
    }

    #[test]
    fn jpeg_keeps_flat_images_and_loses_more_at_lower_quality() {
        let flat = grey(20, 13, 100);
        let out = jpeg_roundtrip(&flat, 50);
        assert_eq!((out.width, out.height), (20, 13));
        assert!(
            out.pixels
                .as_chunks::<4>()
                .0
                .iter()
                .all(|p| p[0].abs_diff(100) <= 1 && p[3] == 255)
        );
        let busy = image(32, 32, |x, y| {
            let v = ((x * 37 + y * 91 + (x * y) % 7 * 53) % 256) as u8;
            [v, 255 - v, v / 2, 255]
        });
        let error = |quality: u8| -> u64 {
            let out = jpeg_roundtrip(&busy, quality);
            out.pixels
                .iter()
                .zip(&busy.pixels)
                .map(|(a, b)| u64::from(a.abs_diff(*b)))
                .sum()
        };
        assert!(
            error(90) < error(50) && error(50) < error(30),
            "{} {} {}",
            error(90),
            error(50),
            error(30)
        );
        assert_eq!(
            jpeg_roundtrip(&busy, 30),
            jpeg_roundtrip(&busy, 30),
            "deterministic"
        );
    }

    #[test]
    fn jpeg_quality_scales_the_standard_table() {
        assert_eq!(scaled_table(&LUMA_TABLE, 50)[0], 16.0);
        assert_eq!(scaled_table(&LUMA_TABLE, 100)[0], 1.0);
        assert_eq!(scaled_table(&LUMA_TABLE, 90)[0], 3.0);
        assert_eq!(scaled_table(&LUMA_TABLE, 30)[0], 27.0);
    }

    #[test]
    fn the_transform_enum_applies_each_function() {
        let source = gradient(12, 8);
        assert_eq!(Transform::Gamma(1.0).apply(&source), source);
        assert_eq!(Transform::Shift { dx: 0, dy: 0 }.apply(&source), source);
        let scaled = Transform::ScaleToHeight(16).apply(&source);
        assert_eq!((scaled.width, scaled.height), (scaled_width(16), 16));
        assert_eq!(
            Transform::Resize {
                width: 5,
                height: 4
            }
            .apply(&source)
            .width,
            5
        );
        assert_eq!(Transform::CropAspect { w: 1, h: 1 }.apply(&source).width, 8);
        assert_eq!(
            Transform::PadAspect { w: 1, h: 1 }.apply(&source).height,
            12
        );
        let bars = Transform::AddBars {
            top: 2,
            right: 0,
            bottom: 0,
            left: 0,
        };
        assert_eq!(bars.apply(&source).height, 10);
        let cut = Transform::CropEdges {
            top: 2,
            right: 0,
            bottom: 0,
            left: 0,
        };
        assert_eq!(cut.apply(&source).height, 6);
        for transform in [
            Transform::Brightness(1.3),
            Transform::Contrast(0.7),
            Transform::Saturation(0.5),
            Transform::Temperature(-0.1),
            Transform::Blur(1.0),
            Transform::Unsharp {
                sigma: 1.0,
                amount: 1.0,
            },
            Transform::Jpeg(70),
            Transform::Noise {
                sigma: 4.0,
                seed: 1,
            },
            Transform::Rgb565,
        ] {
            let out = transform.apply(&source);
            assert_eq!((out.width, out.height), (12, 8), "{transform:?}");
        }
    }
}
