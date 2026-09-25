// Cytoscape wrapper: root → 4 branches → words (and child words). Updated incrementally.
import { BRANCHES, COLORS } from './i18n.js';

const LAYOUT = {
  name: 'cose',
  animate: true,
  animationDuration: 500,
  randomize: false,
  nodeDimensionsIncludeLabels: true,
  idealEdgeLength: () => 70,
  nodeRepulsion: () => 9000,
  edgeElasticity: () => 80,
  gravity: 0.6,
  numIter: 1200,
  padding: 30,
};

const labelWidth = (ele, charW, pad) => Math.max(40, String(ele.data('label') || '').length * charW + pad);

function style() {
  return [
    {
      selector: 'node',
      style: {
        label: 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-family': 'ui-sans-serif, system-ui, sans-serif',
        'font-size': 12,
        shape: 'round-rectangle',
        'transition-property': 'opacity, background-color, border-width',
        'transition-duration': 150,
      },
    },
    {
      selector: 'node[type="root"]',
      style: {
        'background-color': '#0f172a',
        color: '#fff',
        'font-size': 15,
        'font-weight': 700,
        width: (e) => labelWidth(e, 9, 32),
        height: 44,
      },
    },
    {
      selector: 'node[type="branch"]',
      style: {
        'background-color': 'data(color)',
        color: '#fff',
        'font-size': 13,
        'font-weight': 700,
        width: (e) => labelWidth(e, 8, 28),
        height: 34,
      },
    },
    {
      selector: 'node[type="word"]',
      style: {
        'background-color': 'data(color)',
        'border-width': 2,
        'border-color': 'data(color)',
        color: '#fff',
        width: (e) => labelWidth(e, 7, 20),
        height: 26,
      },
    },
    {
      selector: 'node[type="word"].off',
      style: {
        'background-color': '#fff',
        color: '#64748b',
        opacity: 0.75,
        'border-style': 'dashed',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': 'data(color)',
        opacity: 0.45,
        'curve-style': 'bezier',
      },
    },
    { selector: '.dim', style: { opacity: 0.12 } },
    { selector: 'node.hl', style: { 'border-width': 4, 'border-color': '#0f172a', 'z-index': 10 } },
    { selector: 'node.active', style: { 'border-width': 3, 'border-color': '#0f172a', 'border-style': 'solid' } },
  ];
}

export function createGraph(container, { onWordTap, onWordMenu, onBranchTap, onViewportChange }) {
  const cy = window.cytoscape({
    container,
    style: style(),
    wheelSensitivity: 0.3,
    minZoom: 0.2,
    maxZoom: 3,
    boxSelectionEnabled: false,
    selectionType: 'single',
    autounselectify: true,
  });

  cy.add({ data: { id: 'root', type: 'root', label: '' }, position: { x: 0, y: 0 } });
  BRANCHES.forEach((b, i) => {
    const angle = (Math.PI / 2) * i - Math.PI / 4;
    cy.add({ data: { id: `b-${b}`, type: 'branch', branch: b, color: COLORS[b], label: b }, position: { x: Math.cos(angle) * 160, y: Math.sin(angle) * 160 } });
    cy.add({ data: { id: `e-b-${b}`, source: 'root', target: `b-${b}`, color: COLORS[b] } });
  });

  // A long-press opens the menu; ignore the tap that may follow it.
  let heldAt = 0;
  cy.on('tap', 'node[type="word"]', (evt) => {
    if (Date.now() - heldAt < 800) return;
    onWordTap?.(evt.target.id());
  });
  cy.on('taphold', 'node[type="word"]', (evt) => {
    heldAt = Date.now();
    onWordMenu?.(evt.target.id());
  });
  cy.on('cxttap', 'node[type="word"]', (evt) => onWordMenu?.(evt.target.id()));
  cy.on('tap cxttap', 'node[type="branch"]', (evt) => onBranchTap?.(evt.target.data('branch')));
  cy.on('tap', (evt) => { if (evt.target === cy) onViewportChange?.(); });
  cy.on('pan zoom', () => onViewportChange?.());
  cy.on('grab', 'node', () => onViewportChange?.());

  let firstLayout = true;
  let layout = null;

  function runLayout({ fit = false } = {}) {
    layout?.stop();
    layout = cy.layout({ ...LAYOUT, fit: fit || firstLayout });
    layout.run();
    firstLayout = false;
  }

  function parentNodeId(w, ids) {
    return w.parentId && ids.has(String(w.parentId)) ? String(w.parentId) : `b-${w.branch}`;
  }

  // words: session.words. Adds/updates/removes elements; re-runs layout when nodes were added.
  function syncWords(words) {
    const ids = new Set(words.map((w) => String(w._id)));
    let added = 0;
    let removed = 0;

    cy.batch(() => {
      cy.nodes('[type="word"]').forEach((n) => {
        if (!ids.has(n.id())) { cy.remove(n); removed++; }
      });

      // Parents before children so new children can be placed near them.
      const pending = [...words];
      const placed = new Set(cy.nodes('[type="word"]').map((n) => n.id()));
      let guard = pending.length + 1;
      while (pending.length && guard-- > 0) {
        for (let i = pending.length - 1; i >= 0; i--) {
          const w = pending[i];
          const id = String(w._id);
          const parent = parentNodeId(w, ids);
          if (parent !== `b-${w.branch}` && !placed.has(parent)) continue;
          pending.splice(i, 1);
          const existing = cy.getElementById(id);
          if (existing.nonempty()) {
            existing.data('label', w.text);
            existing.toggleClass('off', !w.selected);
            const edge = cy.getElementById(`e-${id}`);
            if (edge.nonempty() && edge.data('source') !== parent) {
              cy.remove(edge);
              cy.add({ data: { id: `e-${id}`, source: parent, target: id, color: COLORS[w.branch] } });
            }
          } else {
            const p = cy.getElementById(parent).position();
            cy.add({
              data: { id, type: 'word', branch: w.branch, color: COLORS[w.branch], label: w.text },
              classes: w.selected ? '' : 'off',
              position: { x: p.x + (Math.random() - 0.5) * 80, y: p.y + (Math.random() - 0.5) * 80 },
            });
            cy.add({ data: { id: `e-${id}`, source: parent, target: id, color: COLORS[w.branch] } });
            added++;
          }
          placed.add(id);
        }
      }
    });

    if (added) runLayout();
    else if (removed && firstLayout) runLayout();
    return { added, removed };
  }

  function setLabels({ root, branches }) {
    cy.getElementById('root').data('label', root);
    BRANCHES.forEach((b) => cy.getElementById(`b-${b}`).data('label', branches[b]));
  }

  function highlight(wordIds) {
    const set = new Set(wordIds.map(String));
    cy.batch(() => {
      cy.elements().addClass('dim');
      cy.getElementById('root').removeClass('dim');
      set.forEach((id) => {
        const n = cy.getElementById(id);
        if (n.empty()) return;
        n.removeClass('dim').addClass('hl');
        n.predecessors().removeClass('dim');
      });
    });
  }

  function clearHighlight() {
    cy.batch(() => cy.elements().removeClass('dim hl'));
  }

  function setActive(id) {
    cy.nodes('.active').removeClass('active');
    if (id) cy.getElementById(id).addClass('active');
  }

  // Viewport (client) coordinates of a node's right edge, for the floating panel.
  function nodeClientRect(id) {
    const n = cy.getElementById(id);
    if (n.empty()) return null;
    const box = n.renderedBoundingBox();
    const rect = container.getBoundingClientRect();
    return { left: rect.left + box.x1, right: rect.left + box.x2, top: rect.top + box.y1, bottom: rect.top + box.y2 };
  }

  return {
    cy,
    syncWords,
    setLabels,
    highlight,
    clearHighlight,
    setActive,
    nodeClientRect,
    fit: () => cy.animate({ fit: { eles: cy.elements(), padding: 30 } }, { duration: 300 }),
    zoom: (factor) => {
      const c = { x: container.clientWidth / 2, y: container.clientHeight / 2 };
      cy.zoom({ level: cy.zoom() * factor, renderedPosition: c });
    },
    relayout: () => runLayout({ fit: true }),
    resize: () => cy.resize(),
  };
}
