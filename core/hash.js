// Hashing, and the Merkle tree over the register.
//
// Domain separation on leaves and interior nodes, so no interior node can be
// passed off as a leaf.

import crypto from 'node:crypto';

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
export const GENESIS = '0'.repeat(64);

export const leaf = (h) => sha256('\x00' + h);
export const node = (a, b) => sha256('\x01' + a + b);

export function merkleRoot(hashes) {
  if (!hashes.length) return sha256('');
  let level = hashes.map(leaf);
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(node(level[i], level[i + 1] ?? level[i]));
    level = next;
  }
  return level[0];
}

export function merkleProof(hashes, index) {
  const proof = [];
  let level = hashes.map(leaf);
  let idx = index;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i], b = level[i + 1] ?? level[i];
      if (i === idx || i + 1 === idx) { proof.push(idx === i ? { side: 'right', hash: b } : { side: 'left', hash: a }); idx = next.length; }
      next.push(node(a, b));
    }
    level = next;
  }
  return proof;
}

export function verifyProof(hash, proof, root) {
  let h = leaf(hash);
  for (const s of proof) h = s.side === 'right' ? node(h, s.hash) : node(s.hash, h);
  return h === root;
}
