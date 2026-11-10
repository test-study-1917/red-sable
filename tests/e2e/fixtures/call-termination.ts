import { mount } from 'svelte';
import '../../../src/styles.css';
import CallTerminationHarness from './call-termination.svelte';

if (new URLSearchParams(location.search).has('dual')) {
  const { loadModel } = await import('#lib/model/model.js');
  await loadModel();
}

const target = document.getElementById('app');
if (!target) throw new Error('Missing fixture mount point');
mount(CallTerminationHarness, {
  target,
  props: {
    dual: new URLSearchParams(location.search).has('dual'),
    voice: new URLSearchParams(location.search).has('voice'),
  },
});
