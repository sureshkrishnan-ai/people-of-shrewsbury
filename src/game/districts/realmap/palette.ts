// New England in the foundation's palette discipline (design.md): a few clear, slightly warm colours, no noise.
// Houses: clapboard whites, colonial yellows, sage, slate blue, barn red. Commercial: brick, buff, grey.

export const HOUSE_WALLS = ['#F2EEE4', '#EDE3C8', '#E8D49A', '#B9C7B0', '#9FB3C4', '#C8D1D6', '#A4483A', '#D9CBB3', '#F4F1EA', '#8E9C8A']
export const COMMERCIAL_WALLS = ['#B3623F', '#C9B38E', '#D8CDB8', '#A8A39A', '#9A5B44', '#E3D9C4']
export const ROOFS = ['#4A4E57', '#5A5550', '#3E434C', '#6B5A4E', '#55606A', '#7A4B3A']

export const GROUND = {
  lawn: '#8FB069',
  park: '#7FA85C',
  sports: '#8CB86A',
  cemetery: '#93A97A',
  golf: '#9CC274',
  school: '#A8B48A',
  parking: '#9A9893',
  wood: '#5F8A45',
  wetland: '#7E9A6A',
  farm: '#C2B67A',
  sand: '#D9C9A0',
  shore: '#7C8A72',
  pavement: '#CFC8BA',
}

/** A small stable integer hash of a number (for picking colours and variants). */
export function hash(v: number) {
  let h = Math.floor(v * 1000) | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  return (h ^ (h >>> 16)) >>> 0
}
