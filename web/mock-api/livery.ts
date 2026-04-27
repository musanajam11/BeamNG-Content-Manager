// Mock implementations for the Livery Editor (UV templates, skin material
// scanner, project save/load, image import, mod export).

const TINY_TRANSPARENT_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII='

export const liveryMocks = {
  liveryGetUVTemplate: async () => ({ template: TINY_TRANSPARENT_PNG, width: 2048, height: 2048 }),
  liveryGetSkinMaterials: async () => [
    { materialName: 'demo_body', texturePath: 'vehicles/sunburst/skin_body.dds', uvChannel: 0 as const, hasPaletteMap: true },
    { materialName: 'demo_interior', texturePath: 'vehicles/sunburst/skin_interior.dds', uvChannel: 1 as const, hasPaletteMap: false }
  ],
  liveryExportSkinMod: async () => ({ success: false, error: 'Demo mode — file export disabled in browser' }),
  liverySaveProject: async () => ({ success: false, error: 'Demo mode' }),
  liveryLoadProject: async () => ({ success: false, error: 'Demo mode' }),
  liveryImportImage: async (): Promise<string | null> => null
}
