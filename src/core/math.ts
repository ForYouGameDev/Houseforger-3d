// Tiny column-major 4x4 matrix helpers (same layout and Euler 'XYZ' convention
// as three.js), so the project model can be transformed without any renderer.

export type Vec3 = [number, number, number];
export type Mat4 = number[]; // 16 numbers, column-major

export function identity(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Returns a * b (apply b first, then a). */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Position, Euler rotation (radians, order XYZ) and scale -> matrix. */
export function compose(position: Vec3, rotation: Vec3, scale: Vec3): Mat4 {
  const [x, y, z] = rotation;
  const a = Math.cos(x);
  const b = Math.sin(x);
  const c = Math.cos(y);
  const d = Math.sin(y);
  const e = Math.cos(z);
  const f = Math.sin(z);
  const ae = a * e;
  const af = a * f;
  const be = b * e;
  const bf = b * f;

  const te = identity();
  te[0] = c * e;
  te[4] = -c * f;
  te[8] = d;
  te[1] = af + be * d;
  te[5] = ae - bf * d;
  te[9] = -b * c;
  te[2] = bf - ae * d;
  te[6] = be + af * d;
  te[10] = a * c;

  const [sx, sy, sz] = scale;
  te[0] *= sx;
  te[1] *= sx;
  te[2] *= sx;
  te[4] *= sy;
  te[5] *= sy;
  te[6] *= sy;
  te[8] *= sz;
  te[9] *= sz;
  te[10] *= sz;

  te[12] = position[0];
  te[13] = position[1];
  te[14] = position[2];
  return te;
}

export interface Decomposed {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/** Matrix -> position, Euler XYZ rotation and scale (shear is discarded). */
export function decompose(m: Mat4): Decomposed {
  let sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);

  const det =
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2]);
  if (det < 0) sx = -sx;

  const isx = sx === 0 ? 0 : 1 / sx;
  const isy = sy === 0 ? 0 : 1 / sy;
  const isz = sz === 0 ? 0 : 1 / sz;

  const m11 = m[0] * isx;
  const m12 = m[4] * isy;
  const m13 = m[8] * isz;
  const m22 = m[5] * isy;
  const m23 = m[9] * isz;
  const m32 = m[6] * isy;
  const m33 = m[10] * isz;

  const ry = Math.asin(Math.max(-1, Math.min(1, m13)));
  let rx: number;
  let rz: number;
  if (Math.abs(m13) < 0.9999999) {
    rx = Math.atan2(-m23, m33);
    rz = Math.atan2(-m12, m11);
  } else {
    rx = Math.atan2(m32, m22);
    rz = 0;
  }
  return {
    position: [m[12], m[13], m[14]],
    rotation: [rx, ry, rz],
    scale: [sx, sy, sz],
  };
}

/** Inverse of an affine matrix (last row 0,0,0,1). Throws if singular. */
export function invertAffine(m: Mat4): Mat4 {
  const m00 = m[0];
  const m01 = m[4];
  const m02 = m[8];
  const m10 = m[1];
  const m11 = m[5];
  const m12 = m[9];
  const m20 = m[2];
  const m21 = m[6];
  const m22 = m[10];
  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20);
  if (Math.abs(det) < 1e-12) throw new Error('Matrix is singular');

  const i00 = (m11 * m22 - m12 * m21) / det;
  const i01 = (m02 * m21 - m01 * m22) / det;
  const i02 = (m01 * m12 - m02 * m11) / det;
  const i10 = (m12 * m20 - m10 * m22) / det;
  const i11 = (m00 * m22 - m02 * m20) / det;
  const i12 = (m02 * m10 - m00 * m12) / det;
  const i20 = (m10 * m21 - m11 * m20) / det;
  const i21 = (m01 * m20 - m00 * m21) / det;
  const i22 = (m00 * m11 - m01 * m10) / det;

  const tx = m[12];
  const ty = m[13];
  const tz = m[14];

  const out = identity();
  out[0] = i00;
  out[1] = i10;
  out[2] = i20;
  out[4] = i01;
  out[5] = i11;
  out[6] = i21;
  out[8] = i02;
  out[9] = i12;
  out[10] = i22;
  out[12] = -(i00 * tx + i01 * ty + i02 * tz);
  out[13] = -(i10 * tx + i11 * ty + i12 * tz);
  out[14] = -(i20 * tx + i21 * ty + i22 * tz);
  return out;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
