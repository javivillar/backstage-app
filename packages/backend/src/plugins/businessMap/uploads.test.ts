import { resolveUpload, stageUpload } from './uploads';

describe('uploads held between the preview and the template', () => {
  it('gives a small reference and resolves it to the file', () => {
    const file = `data:text/csv;base64,${Buffer.from('ID,Title\n1.0,A').toString('base64')}`;
    const ref = stageUpload(file);
    expect(ref.length).toBeLessThan(200);
    expect(resolveUpload(ref)).toBe(file);
  });
  it('passes any other value through', () => {
    expect(resolveUpload('data:text/csv;base64,QQ==')).toBe('data:text/csv;base64,QQ==');
  });
  it('refuses a reference it no longer holds', () => {
    const ref = stageUpload('data:text/csv;base64,QQ==', 0);
    expect(() => resolveUpload(ref, 2 * 60 * 60 * 1000)).toThrow('no longer holds');
    expect(() => resolveUpload('data:application/x-business-model-upload;name=00000000-0000-0000-0000-000000000000;base64,')).toThrow('no longer holds');
  });
});
