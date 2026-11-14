import qrcode from 'qrcode-generator';

/**
 * Contenido del código QR del pase de abordar, SIN pantalla (lo reutilizan la web y React Native): una matriz de módulos que cada vista
 * dibuja a su manera. Se genera en el dispositivo; el valor del pase nunca sale a un servicio externo. El QR codifica EXACTAMENTE el
 * valor del pase (`barcode`), sin prefijos ni adornos.
 */
export interface QrMatrix {
  /** Módulos por lado (sin la zona de silencio). */
  size: number;
  /** `true` = módulo oscuro. Índice `fila * size + columna`. */
  modules: readonly boolean[];
}

/** Los bytes del valor se codifican en UTF-8 (lo que leen los lectores de QR); por omisión la librería usa ISO-8859-1. */
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

/** Nivel de corrección «M»: buen equilibrio entre tamaño y tolerancia a impresión o pantallas rayadas. */
const LEVEL = 'M';
/** Un valor de pase real mide decenas de caracteres; más de esto no es un pase. */
export const MAX_QR_VALUE_LENGTH = 1000;

/** Matriz QR del valor; `null` si el valor está vacío o es demasiado largo (la vista entonces solo muestra el texto). */
export function boardingPassQr(value: string): QrMatrix | null {
  if (value.length === 0 || value.length > MAX_QR_VALUE_LENGTH) return null;
  try {
    const qr = qrcode(0, LEVEL);
    qr.addData(value, 'Byte');
    qr.make();
    const size = qr.getModuleCount();
    const modules: boolean[] = [];
    for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) modules.push(qr.isDark(row, column));
    return { size, modules };
  } catch {
    return null;
  }
}
