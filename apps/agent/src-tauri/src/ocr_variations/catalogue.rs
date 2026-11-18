//! The catalogue of variations of one screenshot: every single transform, then seeded combinations of two or three from
//! different families. Deterministic for a seed, so a run can be reproduced and a variant id means the same image every time.
use d2rmm_agent_core::ports::Rgba;

use super::transforms::{SplitMix64, Transform};

/// The families of single variations, in the order a combination applies them (capture geometry first, compression last).
pub const FAMILIES: [&str; 9] = [
    "border", "aspect", "shift", "scale", "tone", "blur", "noise", "quantise", "jpeg",
];

/// The family of the seeded combinations.
pub const COMBO_FAMILY: &str = "combo";

/// How many combinations make about 150 variations per screenshot with the singles.
pub const DEFAULT_COMBOS: usize = 94;

/// The heights of the "scale" family; the width follows the 1920:1033 aspect.
const SCALE_HEIGHTS: [u32; 10] = [720, 768, 864, 900, 1050, 1080, 1200, 1440, 1600, 2160];

/// One variation: a stable id, its family and the transforms applied in order.
#[derive(Debug, Clone, PartialEq)]
pub struct Variation {
    pub id: String,
    pub family: &'static str,
    pub transforms: Vec<Transform>,
}

impl Variation {
    /// The image this variation makes of `image`: each transform in turn.
    pub fn apply(&self, image: &Rgba) -> Rgba {
        let mut transforms = self.transforms.iter();
        let Some(first) = transforms.next() else {
            return image.clone();
        };
        let mut current = first.apply(image);
        for transform in transforms {
            current = transform.apply(&current);
        }
        current
    }
}

fn single(id: String, family: &'static str, transform: Transform) -> Variation {
    Variation {
        id,
        family,
        transforms: vec![transform],
    }
}

/// A float as an id fragment: `0.8`, `1.25`, `2`.
fn number(value: f32) -> String {
    format!("{value}")
}

/// Every single variation, in a fixed order. The noise takes `seed` mixed with its sigma, so the noise differs by seed.
pub fn singles(seed: u64) -> Vec<Variation> {
    let mut out = Vec::new();
    for height in SCALE_HEIGHTS {
        out.push(single(
            format!("scale-{height}"),
            "scale",
            Transform::ScaleToHeight(height),
        ));
    }
    out.push(single(
        "aspect-4x3".to_string(),
        "aspect",
        Transform::CropAspect { w: 4, h: 3 },
    ));
    out.push(single(
        "aspect-21x9".to_string(),
        "aspect",
        Transform::PadAspect { w: 21, h: 9 },
    ));
    for gamma in [0.6, 0.8, 1.25, 1.6] {
        out.push(single(
            format!("gamma-{}", number(gamma)),
            "tone",
            Transform::Gamma(gamma),
        ));
    }
    for factor in [0.7, 0.85, 1.15, 1.3] {
        out.push(single(
            format!("brightness-{}", number(factor)),
            "tone",
            Transform::Brightness(factor),
        ));
    }
    for factor in [0.7, 1.3] {
        out.push(single(
            format!("contrast-{}", number(factor)),
            "tone",
            Transform::Contrast(factor),
        ));
    }
    for factor in [0.0, 0.5, 1.5] {
        out.push(single(
            format!("saturation-{}", number(factor)),
            "tone",
            Transform::Saturation(factor),
        ));
    }
    out.push(single(
        "temperature-warm".to_string(),
        "tone",
        Transform::Temperature(0.12),
    ));
    out.push(single(
        "temperature-cool".to_string(),
        "tone",
        Transform::Temperature(-0.12),
    ));
    for sigma in [0.5, 1.0, 1.5] {
        out.push(single(
            format!("blur-{}", number(sigma)),
            "blur",
            Transform::Blur(sigma),
        ));
    }
    out.push(single(
        "unsharp-strong".to_string(),
        "blur",
        Transform::Unsharp {
            sigma: 1.0,
            amount: 2.0,
        },
    ));
    for quality in [90u8, 70, 50, 30] {
        out.push(single(
            format!("jpeg-{quality}"),
            "jpeg",
            Transform::Jpeg(quality),
        ));
    }
    for sigma in [4.0f32, 8.0, 16.0] {
        out.push(single(
            format!("noise-{}", number(sigma)),
            "noise",
            Transform::Noise {
                sigma,
                seed: seed ^ u64::from(sigma as u32).wrapping_mul(0x9E37_79B9),
            },
        ));
    }
    out.push(single("rgb565".to_string(), "quantise", Transform::Rgb565));
    for magnitude in 1..=3i32 {
        for (name, dx, dy) in [
            ("right", magnitude, 0),
            ("left", -magnitude, 0),
            ("down", 0, magnitude),
            ("up", 0, -magnitude),
        ] {
            out.push(single(
                format!("shift-{name}-{magnitude}"),
                "shift",
                Transform::Shift { dx, dy },
            ));
        }
    }
    let bars = |top, right, bottom, left| Transform::AddBars {
        top,
        right,
        bottom,
        left,
    };
    let cut = |top, right, bottom, left| Transform::CropEdges {
        top,
        right,
        bottom,
        left,
    };
    out.push(single(
        "border-crop-top-8".to_string(),
        "border",
        cut(8, 0, 0, 0),
    ));
    out.push(single(
        "border-crop-bottom-8".to_string(),
        "border",
        cut(0, 0, 8, 0),
    ));
    out.push(single(
        "border-bar-top-8".to_string(),
        "border",
        bars(8, 0, 0, 0),
    ));
    out.push(single(
        "border-bar-top-31".to_string(),
        "border",
        bars(31, 0, 0, 0),
    ));
    out.push(single(
        "border-frame-8".to_string(),
        "border",
        bars(8, 8, 8, 8),
    ));
    out
}

fn rank(family: &str) -> usize {
    FAMILIES
        .iter()
        .position(|name| *name == family)
        .unwrap_or(FAMILIES.len())
}

/// A uniform index below `bound` (non-zero).
fn pick(rng: &mut SplitMix64, bound: usize) -> usize {
    (rng.next_u64() % bound as u64) as usize
}

/// The catalogue: every single, then `combos` seeded combinations of two or three transforms from different families, one
/// of them a scale step in half of the combinations. A combination applies its transforms in `FAMILIES` order.
pub fn catalogue(seed: u64, combos: usize) -> Vec<Variation> {
    let singles = singles(seed);
    let mut by_family: Vec<Vec<&Variation>> = vec![Vec::new(); FAMILIES.len()];
    for variation in &singles {
        by_family[rank(variation.family)].push(variation);
    }
    let scale = rank("scale");
    let others: Vec<usize> = (0..FAMILIES.len())
        .filter(|family| *family != scale)
        .collect();
    let mut rng = SplitMix64(seed ^ 0xC0FF_EE00_D2D2_D2D2);
    let mut out = singles.clone();
    for number in 0..combos {
        let count = 2 + pick(&mut rng, 2);
        let with_scale = pick(&mut rng, 2) == 0;
        let mut families = Vec::new();
        if with_scale {
            families.push(scale);
        }
        let mut pool = others.clone();
        while families.len() < count {
            let at = pick(&mut rng, pool.len());
            families.push(pool.remove(at));
        }
        families.sort_unstable();
        let transforms = families
            .iter()
            .map(|family| {
                let choices = &by_family[*family];
                choices[pick(&mut rng, choices.len())].transforms[0].clone()
            })
            .collect();
        out.push(Variation {
            id: format!("combo-{number:03}"),
            family: COMBO_FAMILY,
            transforms,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::collections::HashSet;

    use super::*;

    fn count_by_family(variations: &[Variation]) -> BTreeMap<&'static str, usize> {
        let mut counts = BTreeMap::new();
        for variation in variations {
            *counts.entry(variation.family).or_insert(0) += 1;
        }
        counts
    }

    #[test]
    fn ids_are_unique() {
        let all = catalogue(1, DEFAULT_COMBOS);
        let ids: HashSet<&str> = all.iter().map(|v| v.id.as_str()).collect();
        assert_eq!(ids.len(), all.len());
    }

    #[test]
    fn the_catalogue_is_the_same_for_a_seed_and_differs_for_another() {
        assert_eq!(catalogue(5, 30), catalogue(5, 30));
        assert_ne!(catalogue(5, 30), catalogue(6, 30));
    }

    #[test]
    fn counts_per_family_and_the_default_total() {
        let all = catalogue(1, DEFAULT_COMBOS);
        let counts = count_by_family(&all);
        assert_eq!(counts["scale"], 10);
        assert_eq!(counts["aspect"], 2);
        assert_eq!(counts["tone"], 15);
        assert_eq!(counts["blur"], 4);
        assert_eq!(counts["jpeg"], 4);
        assert_eq!(counts["noise"], 3);
        assert_eq!(counts["quantise"], 1);
        assert_eq!(counts["shift"], 12);
        assert_eq!(counts["border"], 5);
        assert_eq!(counts["combo"], DEFAULT_COMBOS);
        assert_eq!(all.len(), 150);
        assert_eq!(catalogue(1, 0).len(), 56);
    }

    #[test]
    fn single_ids_follow_the_values() {
        let ids: Vec<String> = singles(1).into_iter().map(|v| v.id).collect();
        for expected in [
            "scale-720",
            "scale-2160",
            "aspect-4x3",
            "aspect-21x9",
            "gamma-0.6",
            "gamma-1.25",
            "brightness-0.85",
            "contrast-1.3",
            "saturation-0",
            "saturation-1.5",
            "temperature-warm",
            "blur-0.5",
            "unsharp-strong",
            "jpeg-90",
            "jpeg-30",
            "noise-16",
            "rgb565",
            "shift-left-2",
            "shift-up-3",
            "border-bar-top-8",
            "border-crop-top-8",
        ] {
            assert!(ids.iter().any(|id| id == expected), "{expected} in {ids:?}");
        }
    }

    #[test]
    fn a_combination_mixes_two_or_three_families_and_scales_about_half_the_time() {
        let all = catalogue(3, 200);
        let combos: Vec<&Variation> = all.iter().filter(|v| v.family == COMBO_FAMILY).collect();
        assert_eq!(combos.len(), 200);
        let family_of = |transform: &Transform| -> usize {
            let single = singles(3)
                .into_iter()
                .find(|v| v.transforms[0] == *transform)
                .expect("a combination uses only singles");
            rank(single.family)
        };
        let mut scaled = 0;
        for combo in &combos {
            assert!((2..=3).contains(&combo.transforms.len()), "{}", combo.id);
            let families: Vec<usize> = combo.transforms.iter().map(family_of).collect();
            let mut unique = families.clone();
            unique.dedup();
            assert_eq!(
                unique, families,
                "{}: distinct, in application order",
                combo.id
            );
            assert!(families.windows(2).all(|pair| pair[0] < pair[1]));
            if families.contains(&rank("scale")) {
                scaled += 1;
            }
        }
        assert!((70..=130).contains(&scaled), "about half scale: {scaled}");
    }

    #[test]
    fn a_variation_applies_its_transforms_in_order() {
        let image = Rgba {
            width: 8,
            height: 8,
            pixels: vec![128; 8 * 8 * 4],
        };
        let variation = Variation {
            id: "x".to_string(),
            family: COMBO_FAMILY,
            transforms: vec![
                Transform::AddBars {
                    top: 2,
                    right: 0,
                    bottom: 0,
                    left: 0,
                },
                Transform::CropAspect { w: 1, h: 1 },
            ],
        };
        let out = variation.apply(&image);
        assert_eq!(
            (out.width, out.height),
            (8, 8),
            "10 high then cropped to 8x8"
        );
        let none = Variation {
            id: "n".to_string(),
            family: COMBO_FAMILY,
            transforms: Vec::new(),
        };
        assert_eq!(none.apply(&image), image);
    }

    #[test]
    fn noise_differs_by_seed() {
        let noise = |seed| {
            singles(seed)
                .into_iter()
                .find(|v| v.id == "noise-8")
                .unwrap()
                .transforms
        };
        assert_ne!(noise(1), noise(2));
        assert_eq!(noise(1), noise(1));
    }
}
