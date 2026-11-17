import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceBar } from '../components/WorkspaceBar.js';
import { workspaceState } from '../local/circuitWorkspace.js';
import { saveWorkspace } from '../local/workspace.js';
import { axe } from './axe.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// This file has its own module registry, so the workspace has not been read yet when the test starts.
describe('a saved workspace that cannot be read', () => {
  it('says why in plain words and offers a Clear workspace that works', async () => {
    const user = userEvent.setup();
    await saveWorkspace({ version: 1, data: { circuits: 'not a list' }, backup: null });
    const { container } = render(<WorkspaceBar />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The saved workspace in this browser cannot be read (data circuits: expected a list of circuits, got "not a list"). Clear it to start again, or import a workspace file to replace it.');
    expect(workspaceState().ready).toBe(false);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Clear workspace' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear workspace' });
    expect(dialog).toHaveTextContent('This removes the saved workspace from this browser. It cannot be undone.');
    await user.click(within(dialog).getByRole('button', { name: 'Clear workspace' }));

    expect(await screen.findByText('Workspace cleared.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(workspaceState()).toMatchObject({ ready: true, data: null });
    expect(screen.queryByRole('button', { name: 'Clear workspace' })).toBeNull();
  });
});
