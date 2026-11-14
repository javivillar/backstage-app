# bpmn-js viewer

`bpmn-navigated-viewer.production.min.js` is the navigated viewer of [bpmn-js](https://github.com/bpmn-io/bpmn-js)
17.11.1, copied unchanged from `https://unpkg.com/bpmn-js@17.11.1/dist/` (sha256
`119a38feec2f28123e3c8270d7f2dd483afb0844b59d778461e8134c04b6a0f3`). The console loads it on demand to draw the
BPMN model of a business process (`plugins/console/src/components/businessMap/bpmnViewer.ts`); it is served by
Backstage itself, so it works without internet access.

Licence: `LICENSE` (the bpmn.io licence: free to use and redistribute; the bpmn.io watermark of the diagrams must stay
visible and unchanged).
