import Editor from '@monaco-editor/react';
import { Alert, Box, Button, DialogActions, DialogContent, useTheme } from '@mui/material';
import React from 'react';
import { validateConfig } from './kind';

export interface ManifestEditorProps {
  /** The config the editor opens with: the last draft, or the default. */
  initial: string;
  /** What Reset puts back: the default single-node config. */
  template: string;
  /** Called on each edit, so the draft survives closing the editor. */
  onChange: (config: string) => void;
  onCreate: (config: string) => void;
  onClose: () => void;
}

/**
 * A kind config editor laid out like Headlamp's own create editor, for the
 * custom cluster activity. It only edits text: the kind page runs the create.
 */
export default function ManifestEditor({
  initial,
  template,
  onChange,
  onCreate,
  onClose,
}: ManifestEditorProps) {
  const theme = useTheme();
  const [config, setConfig] = React.useState(initial);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const invalid = validateConfig(config);

  function update(next: string) {
    setConfig(next);
    onChange(next);
  }

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Let the same file be picked again after editing it on disk.
    event.target.value = '';
    if (!file) {
      return;
    }
    try {
      update(await file.text());
      setUploadError(null);
    } catch (err) {
      setUploadError(`Could not read ${file.name}: ${(err as Error).message}`);
    }
  }

  return (
    <Box display="flex" flexDirection="column" height="100%">
      <DialogContent
        sx={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: '400px' }}
      >
        <Box py={1} display="flex" justifyContent="flex-end">
          <input
            ref={fileInput}
            type="file"
            accept=".yaml,.yml"
            aria-label="kind config file to upload"
            hidden
            onChange={handleUpload}
          />
          <Button variant="contained" onClick={() => fileInput.current?.click()}>
            Upload file
          </Button>
        </Box>
        {uploadError && (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setUploadError(null)}>
            {uploadError}
          </Alert>
        )}
        <Box flexGrow={1} minHeight={0}>
          <Editor
            language="yaml"
            theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
            value={config}
            onChange={value => update(value ?? '')}
            options={{
              ariaLabel: 'kind config',
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              tabSize: 2,
            }}
            height="100%"
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          color="secondary"
          variant="contained"
          disabled={config === template}
          onClick={() => update(template)}
        >
          Reset
        </Button>
        <Box flex="1 0 0" />
        <Button color="secondary" variant="contained" onClick={onClose}>
          Close
        </Button>
        <Button
          color="primary"
          variant="contained"
          disabled={invalid !== null}
          title={invalid ?? undefined}
          onClick={() => onCreate(config)}
        >
          Create
        </Button>
      </DialogActions>
    </Box>
  );
}
