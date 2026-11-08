import { mount } from 'svelte';
import '../../../src/styles.css';
import CallTerminationHarness from './call-termination.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Missing fixture mount point');
mount(CallTerminationHarness, { target });
