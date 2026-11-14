/**
 * Marca PROVISIONAL (diseño F12c-0 §2). ÚNICO lugar con el nombre comercial, los textos institucionales, las rutas destacadas
 * por origen y las fotografías con su crédito. Las pantallas no escriben nada de esto a mano.
 * Para reemplazar la marca: docs/dev/f12c0-diseno-front.md §2.3 (este archivo, `assets/**` y `design-tokens/src/tokens.ts`).
 * Sin dependencias ni APIs de plataforma: los archivos se nombran por su ruta relativa a `packages/brand/assets/`
 * y cada plataforma los resuelve (web: `platform/web/src/brand/assets.ts`).
 */
export interface PhotoCredit { author: string; license: string; licenseUrl: string; sourceUrl: string }
export interface Photo { /** Ruta relativa a `assets/`. */ file: string; alt: string; credit: PhotoCredit }
export interface FeaturedRoute { destination: string; photo: PhotoKey; tag: string; blurb: string }
export interface FooterColumn { title: string; links: Array<{ label: string; to: string }> }

const BY_SA_3 = { license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0' };
const BY_SA_4 = { license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0' };
const BY_2 = { license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0' };

/** Fotografías con licencia libre (Wikimedia Commons). El crédito se muestra junto a cada imagen. */
const photos = {
  hero: { file: 'photos/hero.jpg', alt: 'Ala de un avión sobre un mar de nubes', credit: { author: 'Rillke', ...BY_SA_3, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Cumulus_clouds_from_above.JPG' } },
  galapagos: { file: 'photos/galapagos.jpg', alt: 'Roca Pináculo y bahía de la isla Bartolomé, Galápagos', credit: { author: 'Cayambe', ...BY_SA_3, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Bartolom%C3%A9_Island_Pinnacle_Rock.jpg' } },
  cuenca: { file: 'photos/cuenca.jpg', alt: 'Cúpulas azules de la Catedral de la Inmaculada Concepción, Cuenca', credit: { author: 'Bernard Gagnon', ...BY_SA_3, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Catedral_de_la_Inmaculada_Concepci%C3%B3n,_Cuenca.jpg' } },
  guayaquil: { file: 'photos/guayaquil.jpg', alt: 'Malecón 2000 a orillas del río Guayas, Guayaquil', credit: { author: 'Padaguan', ...BY_SA_3, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Malec%C3%B3n_2000_en_Guayaquil.jpg' } },
  quito: { file: 'photos/quito.jpg', alt: 'Centro histórico de Quito con el Panecillo al fondo', credit: { author: 'Ymblanter', ...BY_SA_4, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Quito_Panorama_of_the_historic_center_from_Casa_Bella_Vista_02.jpg' } },
  lima: { file: 'photos/lima.jpg', alt: 'Costa Verde de Lima frente al océano Pacífico', credit: { author: 'magicmonkey', ...BY_2, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Lima_Peru_coast.jpg' } },
  bogota: { file: 'photos/bogota.jpg', alt: 'Bogotá vista desde el cerro de Monserrate', credit: { author: 'Javier Benítez', ...BY_SA_3, sourceUrl: 'https://commons.wikimedia.org/wiki/File:Vista_panor%C3%A1mica_de_Bogot%C3%A1_desde_el_Cerro_de_Monserrate.JPG' } }
} satisfies Record<string, Photo>;
export type PhotoKey = keyof typeof photos;

export const brand = {
  name: 'GabatAIR',
  legalName: 'GabatAIR (marca provisional)',
  tagline: 'Tu próximo viaje empieza aquí',
  contactEmail: 'contacto@gabatair.example',
  logo: { light: 'logo.svg', dark: 'logo-dark.svg' },
  fontsCss: 'fonts/fonts.css',
  photos,
  hero: { photo: 'hero' as PhotoKey, title: '¿A dónde quieres ir?', subtitle: 'Busca vuelos dentro de Ecuador y hacia la región.' },
  /** Rutas destacadas por origen (sin precios: no hay catálogo, diseño §3.1). Cada tarjeta abre el buscador con origen y destino. */
  featuredRoutes: {
    UIO: [
      { destination: 'GPS', photo: 'galapagos', tag: 'Naturaleza', blurb: 'Islas, fauna única y mar turquesa.' },
      { destination: 'CUE', photo: 'cuenca', tag: 'Ciudad patrimonio', blurb: 'Cúpulas, artesanías y calles de piedra.' },
      { destination: 'GYE', photo: 'guayaquil', tag: 'Puerto principal', blurb: 'El malecón, el río y la vida de la Costa.' },
      { destination: 'LIM', photo: 'lima', tag: 'Internacional', blurb: 'Gastronomía y acantilados frente al Pacífico.' }
    ],
    GYE: [
      { destination: 'GPS', photo: 'galapagos', tag: 'Naturaleza', blurb: 'Islas, fauna única y mar turquesa.' },
      { destination: 'UIO', photo: 'quito', tag: 'Capital', blurb: 'Centro histórico a 2.850 metros de altura.' },
      { destination: 'CUE', photo: 'cuenca', tag: 'Ciudad patrimonio', blurb: 'Cúpulas, artesanías y calles de piedra.' },
      { destination: 'BOG', photo: 'bogota', tag: 'Internacional', blurb: 'Cultura y montaña en la capital colombiana.' }
    ]
  } as Record<string, FeaturedRoute[]>,
  experience: [
    { icon: 'luggage', title: 'Al preparar tu viaje', text: 'Revisa tus documentos, tu asiento y tu equipaje con tiempo.' },
    { icon: 'map-pin', title: 'En el aeropuerto', text: 'Consulta el estado de tu vuelo antes de salir de casa.' },
    { icon: 'plane', title: 'Durante el vuelo', text: 'Viaja con tu itinerario y tu pase de abordar a la mano.' }
  ],
  texts: {
    about: 'Aerolínea de demostración. Los vuelos, precios y reservas de este sitio son datos de prueba.',
    testEnvironmentNotice: 'Entorno de pruebas: los vuelos y las reservas no son reales y no se realiza ningún cobro.',
    purchaseComingSoon: 'La compra en línea llega en la próxima versión.',
    footerLegal: 'Marca y contenidos provisionales. Sitio de demostración sin fines comerciales.',
    photoCreditsTitle: 'Créditos de fotografías'
  },
  footer: [
    { title: 'Viaja', links: [{ label: 'Buscar vuelos', to: '/' }, { label: 'Estado de un vuelo', to: '/estado' }] },
    { title: 'Tu cuenta', links: [{ label: 'Iniciar sesión', to: '/acceso' }, { label: 'Crear cuenta', to: '/registro' }, { label: 'Recuperar contraseña', to: '/recuperar' }] }
  ] as FooterColumn[]
} as const;

export type Brand = typeof brand;
/** Orígenes que tienen rutas destacadas, en el orden en que se ofrecen. */
export const featuredOrigins = (): string[] => Object.keys(brand.featuredRoutes);
