/**
 * Lista ÚNICA de países (ADR-F12b1fix-05): la usan la nacionalidad (código ISO 3166-1 alfa-2) y el prefijo del teléfono (código de marcación).
 * Sin importaciones ni DOM. Cada código tiene su bandera en `flag-icons` (una prueba de la web lo comprueba).
 *
 * Solo nombres y códigos de marcación. El número nacional (0 troncal, largo y formato de cada país) NO se decide aquí: lo valida `libphonenumber-js` en la web
 * (ADR-F12b1fix-05, punto 13); el servidor solo exige E.164 (`PHONE_PATTERN`).
 */
export interface Country { code: string; name: string; dial: string }

/** Máximo de dígitos de un número E.164 (sin el `+`). */
export const E164_MAX_DIGITS = 15;

// [código ISO-2, nombre en español, código de marcación]
type Row = readonly [string, string, string];
const ROWS: readonly Row[] = [
  ['AF', 'Afganistán', '93'], ['AL', 'Albania', '355'], ['DE', 'Alemania', '49'], ['AD', 'Andorra', '376'], ['AO', 'Angola', '244'], ['AI', 'Anguila', '1'],
  ['AG', 'Antigua y Barbuda', '1'], ['SA', 'Arabia Saudita', '966'], ['DZ', 'Argelia', '213'], ['AR', 'Argentina', '54'], ['AM', 'Armenia', '374'], ['AW', 'Aruba', '297'],
  ['AU', 'Australia', '61'], ['AT', 'Austria', '43'], ['AZ', 'Azerbaiyán', '994'], ['BS', 'Bahamas', '1'], ['BD', 'Bangladés', '880'], ['BB', 'Barbados', '1'],
  ['BH', 'Baréin', '973'], ['BE', 'Bélgica', '32'], ['BZ', 'Belice', '501'], ['BJ', 'Benín', '229'], ['BM', 'Bermudas', '1'], ['BY', 'Bielorrusia', '375'],
  ['MM', 'Birmania (Myanmar)', '95'], ['BO', 'Bolivia', '591'], ['BA', 'Bosnia y Herzegovina', '387'], ['BW', 'Botsuana', '267'], ['BR', 'Brasil', '55'], ['BN', 'Brunéi', '673'],
  ['BG', 'Bulgaria', '359'], ['BF', 'Burkina Faso', '226'], ['BI', 'Burundi', '257'], ['BT', 'Bután', '975'], ['CV', 'Cabo Verde', '238'], ['KH', 'Camboya', '855'],
  ['CM', 'Camerún', '237'], ['CA', 'Canadá', '1'], ['QA', 'Catar', '974'], ['TD', 'Chad', '235'], ['CZ', 'Chequia', '420'], ['CL', 'Chile', '56'],
  ['CN', 'China', '86'], ['CY', 'Chipre', '357'], ['VA', 'Ciudad del Vaticano', '379'], ['CO', 'Colombia', '57'], ['KM', 'Comoras', '269'], ['CG', 'Congo', '242'],
  ['KP', 'Corea del Norte', '850'], ['KR', 'Corea del Sur', '82'], ['CI', 'Costa de Marfil', '225'], ['CR', 'Costa Rica', '506'], ['HR', 'Croacia', '385'], ['CU', 'Cuba', '53'],
  ['CW', 'Curazao', '599'], ['DK', 'Dinamarca', '45'], ['DM', 'Dominica', '1'], ['EC', 'Ecuador', '593'], ['EG', 'Egipto', '20'], ['SV', 'El Salvador', '503'],
  ['AE', 'Emiratos Árabes Unidos', '971'], ['ER', 'Eritrea', '291'], ['SK', 'Eslovaquia', '421'], ['SI', 'Eslovenia', '386'], ['ES', 'España', '34'], ['US', 'Estados Unidos', '1'],
  ['EE', 'Estonia', '372'], ['SZ', 'Esuatini', '268'], ['ET', 'Etiopía', '251'], ['PH', 'Filipinas', '63'], ['FI', 'Finlandia', '358'], ['FJ', 'Fiyi', '679'],
  ['FR', 'Francia', '33'], ['GA', 'Gabón', '241'], ['GM', 'Gambia', '220'], ['GE', 'Georgia', '995'], ['GH', 'Ghana', '233'], ['GI', 'Gibraltar', '350'],
  ['GD', 'Granada', '1'], ['GR', 'Grecia', '30'], ['GL', 'Groenlandia', '299'], ['GP', 'Guadalupe', '590'], ['GU', 'Guam', '1'], ['GT', 'Guatemala', '502'],
  ['GF', 'Guayana Francesa', '594'], ['GG', 'Guernsey', '44'], ['GN', 'Guinea', '224'], ['GQ', 'Guinea Ecuatorial', '240'], ['GW', 'Guinea-Bisáu', '245'], ['GY', 'Guyana', '592'],
  ['HT', 'Haití', '509'], ['HN', 'Honduras', '504'], ['HK', 'Hong Kong', '852'], ['HU', 'Hungría', '36'], ['IN', 'India', '91'], ['ID', 'Indonesia', '62'],
  ['IQ', 'Irak', '964'], ['IR', 'Irán', '98'], ['IE', 'Irlanda', '353'], ['IS', 'Islandia', '354'], ['KY', 'Islas Caimán', '1'], ['CK', 'Islas Cook', '682'],
  ['FO', 'Islas Feroe', '298'], ['MH', 'Islas Marshall', '692'], ['MP', 'Islas Marianas del Norte', '1'], ['SB', 'Islas Salomón', '677'], ['TC', 'Islas Turcas y Caicos', '1'],
  ['VG', 'Islas Vírgenes Británicas', '1'], ['VI', 'Islas Vírgenes de EE. UU.', '1'], ['IL', 'Israel', '972'], ['IT', 'Italia', '39'], ['JM', 'Jamaica', '1'],
  ['JP', 'Japón', '81'], ['JE', 'Jersey', '44'], ['JO', 'Jordania', '962'], ['KZ', 'Kazajistán', '7'], ['KE', 'Kenia', '254'], ['KG', 'Kirguistán', '996'],
  ['KI', 'Kiribati', '686'], ['XK', 'Kosovo', '383'], ['KW', 'Kuwait', '965'], ['LA', 'Laos', '856'], ['LS', 'Lesoto', '266'], ['LV', 'Letonia', '371'],
  ['LB', 'Líbano', '961'], ['LR', 'Liberia', '231'], ['LY', 'Libia', '218'], ['LI', 'Liechtenstein', '423'], ['LT', 'Lituania', '370'], ['LU', 'Luxemburgo', '352'],
  ['MO', 'Macao', '853'], ['MK', 'Macedonia del Norte', '389'], ['MG', 'Madagascar', '261'], ['MY', 'Malasia', '60'], ['MW', 'Malaui', '265'], ['MV', 'Maldivas', '960'],
  ['ML', 'Malí', '223'], ['MT', 'Malta', '356'], ['MA', 'Marruecos', '212'], ['MQ', 'Martinica', '596'], ['MU', 'Mauricio', '230'], ['MR', 'Mauritania', '222'],
  ['MX', 'México', '52'], ['FM', 'Micronesia', '691'], ['MD', 'Moldavia', '373'], ['MC', 'Mónaco', '377'], ['MN', 'Mongolia', '976'], ['ME', 'Montenegro', '382'],
  ['MS', 'Montserrat', '1'], ['MZ', 'Mozambique', '258'], ['NA', 'Namibia', '264'], ['NR', 'Nauru', '674'], ['NP', 'Nepal', '977'], ['NI', 'Nicaragua', '505'],
  ['NE', 'Níger', '227'], ['NG', 'Nigeria', '234'], ['NO', 'Noruega', '47'], ['NC', 'Nueva Caledonia', '687'], ['NZ', 'Nueva Zelanda', '64'], ['OM', 'Omán', '968'],
  ['NL', 'Países Bajos', '31'], ['PK', 'Pakistán', '92'], ['PW', 'Palaos', '680'], ['PS', 'Palestina', '970'], ['PA', 'Panamá', '507'], ['PG', 'Papúa Nueva Guinea', '675'],
  ['PY', 'Paraguay', '595'], ['PE', 'Perú', '51'], ['PF', 'Polinesia Francesa', '689'], ['PL', 'Polonia', '48'], ['PT', 'Portugal', '351'], ['PR', 'Puerto Rico', '1'],
  ['GB', 'Reino Unido', '44'], ['CF', 'República Centroafricana', '236'], ['CD', 'República Democrática del Congo', '243'], ['DO', 'República Dominicana', '1'],
  ['RE', 'Reunión', '262'], ['RW', 'Ruanda', '250'], ['RO', 'Rumanía', '40'], ['RU', 'Rusia', '7'], ['WS', 'Samoa', '685'], ['AS', 'Samoa Americana', '1'],
  ['KN', 'San Cristóbal y Nieves', '1'], ['SM', 'San Marino', '378'], ['VC', 'San Vicente y las Granadinas', '1'], ['LC', 'Santa Lucía', '1'], ['ST', 'Santo Tomé y Príncipe', '239'],
  ['SN', 'Senegal', '221'], ['RS', 'Serbia', '381'], ['SC', 'Seychelles', '248'], ['SL', 'Sierra Leona', '232'], ['SG', 'Singapur', '65'], ['SY', 'Siria', '963'],
  ['SO', 'Somalia', '252'], ['LK', 'Sri Lanka', '94'], ['ZA', 'Sudáfrica', '27'], ['SD', 'Sudán', '249'], ['SS', 'Sudán del Sur', '211'], ['SE', 'Suecia', '46'],
  ['CH', 'Suiza', '41'], ['SR', 'Surinam', '597'], ['TH', 'Tailandia', '66'], ['TW', 'Taiwán', '886'], ['TZ', 'Tanzania', '255'], ['TJ', 'Tayikistán', '992'],
  ['TL', 'Timor Oriental', '670'], ['TG', 'Togo', '228'], ['TO', 'Tonga', '676'], ['TT', 'Trinidad y Tobago', '1'], ['TN', 'Túnez', '216'], ['TM', 'Turkmenistán', '993'],
  ['TR', 'Turquía', '90'], ['TV', 'Tuvalu', '688'], ['UA', 'Ucrania', '380'], ['UG', 'Uganda', '256'], ['UY', 'Uruguay', '598'], ['UZ', 'Uzbekistán', '998'],
  ['VU', 'Vanuatu', '678'], ['VE', 'Venezuela', '58'], ['VN', 'Vietnam', '84'], ['YE', 'Yemen', '967'], ['DJ', 'Yibuti', '253'], ['ZM', 'Zambia', '260'], ['ZW', 'Zimbabue', '263']
];

const collator = new Intl.Collator('es');
/** Países ordenados por nombre (orden del español). */
export const COUNTRIES: readonly Country[] = ROWS.map(([code, name, dial]) => ({ code, name, dial })).sort((a, b) => collator.compare(a.name, b.name));
const BY_CODE: ReadonlyMap<string, Country> = new Map(COUNTRIES.map((country) => [country.code, country]));

export const DEFAULT_COUNTRY = 'EC';
export const countryByCode = (code: string): Country | undefined => BY_CODE.get(code);

/** Minúsculas y sin tildes, para buscar «peru» y encontrar «Perú». */
export const searchKey = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Búsqueda por nombre (cualquier parte), por código ISO (`ec`) o por código de marcación (`593` o `+593`). Primero los que EMPIEZAN con lo escrito, luego los que lo contienen;
 * dentro de cada grupo, el orden alfabético de la lista.
 */
export function searchCountries(query: string, list: readonly Country[] = COUNTRIES): readonly Country[] {
  const text = searchKey(query);
  if (!text) return list;
  const dialQuery = /^\+?\d+$/.test(text) ? text.replace('+', '') : null;
  const starts: Country[] = []; const contains: Country[] = [];
  for (const country of list) {
    const name = searchKey(country.name);
    if (dialQuery !== null) { if (country.dial.startsWith(dialQuery)) starts.push(country); continue; }
    if (name.startsWith(text) || country.code.toLowerCase() === text) starts.push(country); else if (name.includes(text)) contains.push(country);
  }
  return [...starts, ...contains];
}
