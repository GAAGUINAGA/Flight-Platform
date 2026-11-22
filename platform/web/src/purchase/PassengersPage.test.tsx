import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
// (la espera real de PAS-05 es de 2 s: el contador no se simula, se mide con el reloj monótono)
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../data/errors';
import { memoryStore } from '../data/identity';
import { BACK, hold, OFFER, signedIn, startedPurchase } from '../../test/purchase-fixtures';
import { customer, counterIds, itinerary, renderApp } from '../../test/utils';
import { IntentBook } from './intent';
import { birthDateRange, draftPhone, expiryRange, lastTravelDate, shiftYears } from './passenger-rules';
import { PurchaseStore } from './purchase-store';

const handlers = { Hold: () => hold(), SeatMap: () => ({}) };
/** Texto al que apunta `aria-describedby` del campo. */
const described = (element: HTMLElement): string => (element.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
const gone = () => { throw new AppError({ category: 'GONE', code: 'HOLD_EXPIRED', correlationId: 'c' }); };

describe('datos de los pasajeros (§3.6)', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('PAS-01 sin hold no hay formulario: pide elegir los asientos primero', async () => {
    renderApp('/compra/pasajeros', { session: signedIn() });
    expect(await screen.findByRole('heading', { name: 'Primero elige tus asientos' })).toBeInTheDocument();
  });

  it('PAS-02 un formulario por pasajero con sus asientos; enviar vacío marca cada campo y no avanza', async () => {
    const user = userEvent.setup();
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true }).purchase, handlers });
    expect(await screen.findByRole('heading', { name: 'Pasajero 1 · Adulto' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pasajero 2 · Adulto' })).toBeInTheDocument();
    expect(screen.getByText('Asientos: FP103: 8A')).toBeInTheDocument(); expect(screen.getByText('Asientos: FP103: 8B')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    const summary = await screen.findByRole('alert'); expect(summary).toHaveTextContent('Revisa los datos marcados.');
    expect(screen.getAllByText('Escribe los nombres solo con letras, espacios, apóstrofo, guion o punto (hasta 50 caracteres).')).toHaveLength(2);
    expect(screen.getAllByText('Escribe la fecha de nacimiento.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Pago' })).not.toBeInTheDocument();
    // Los errores nombran el campo pero jamás muestran lo escrito.
    await user.type(screen.getAllByLabelText('Número de documento')[0], '12');
    expect(screen.getAllByText('La cédula ecuatoriana lleva exactamente 10 números.')[0]).toBeInTheDocument();
  });

  describe('validación al salir del campo, al enviar y errores del servidor (ADR-F12b1fix-05)', () => {
    const open = (patch: (store: PurchaseStore) => void = () => undefined, withPassengers = false) => {
      const started = startedPurchase({ withHold: true, withPassengers }); patch(started.purchase);
      return renderApp('/compra/pasajeros', { session: signedIn(), purchase: started.purchase, handlers });
    };

    it('PAS-11 mientras se escribe no hay error (no se bloquea la escritura); al salir del campo aparece, asociado al campo, y al corregirlo y salir desaparece', async () => {
      const user = userEvent.setup(); open();
      const first = (await screen.findAllByLabelText('Nombres'))[0];
      await user.type(first, '-Ana'); expect(first).toHaveValue('-Ana'); // el guion se admite al teclear; la regla (empezar con letra) se avisa al salir
      expect(first).not.toHaveAttribute('aria-invalid'); expect(screen.queryByText(/Escribe los nombres solo con letras/)).not.toBeInTheDocument();
      await user.tab(); // sale del campo
      const message = await screen.findByText(/Escribe los nombres solo con letras/);
      expect(first).toHaveAttribute('aria-invalid', 'true'); expect(described(first)).toBe(message.textContent);
      expect(first.getAttribute('aria-describedby')).toBe(message.id);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(); // el resumen es del envío, no de salir de un campo
      await user.clear(first); await user.type(first, 'Ana María'); await user.tab();
      expect(first).not.toHaveAttribute('aria-invalid'); expect(screen.queryByText(/Escribe los nombres solo con letras/)).not.toBeInTheDocument();
    });

    it('PAS-12 al salir del campo se normaliza: nombres sin espacios de más (espacios repetidos y de los extremos)', async () => {
      const user = userEvent.setup(); open();
      const [first] = await screen.findAllByLabelText('Nombres');
      await user.type(first, '  Ana    María  '); expect(first).toHaveValue('  Ana    María  '); // al teclear, los espacios son válidos para el filtro
      await user.tab(); expect(first).toHaveValue('Ana María');
    });

    it('PAS-13 el teléfono sin número se rechaza al salir del campo y la ayuda del país sigue visible junto al error', async () => {
      const user = userEvent.setup(); open();
      const phone = await screen.findByLabelText('Teléfono de contacto');
      expect(screen.getByText('Elige el país y escribe solo tu número, sin el código de país.')).toBeInTheDocument();
      await user.click(phone); await user.tab();
      expect(phone).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText('Escribe tu número completo, solo con dígitos; el código de país ya está elegido.')).toBeInTheDocument();
      expect(screen.getByText('Elige el país y escribe solo tu número, sin el código de país.')).toBeInTheDocument();
      expect(phone.getAttribute('aria-describedby')?.split(' ')).toHaveLength(2);
    });

    it('PAS-14 al enviar con datos inválidos: resumen (alert) con un enlace por campo, foco en el primer campo con error, y lo escrito se conserva', async () => {
      const user = userEvent.setup(); open((store) => store.setDrafts(store.getState().drafts.map((draft, index) => (index === 0 ? { ...draft, firstName: 'Ana', documentNumber: '1712-345-678' } : draft))));
      const [first] = await screen.findAllByLabelText('Nombres');
      await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
      const summary = await screen.findByRole('alert'); expect(summary).toHaveTextContent('Revisa los datos marcados.');
      const links = within(summary).getAllByRole('link').map((link) => link.textContent);
      expect(links[0]).toBe('Pasajero 1: Apellidos'); expect(links).toContain('Pasajero 2: Nombres'); expect(links).toContain('Pasajero 1: Fecha de nacimiento'); expect(links).not.toContain('Pasajero 1: Número de documento'); // el documento con guiones es válido normalizado
      const lastName = screen.getAllByLabelText('Apellidos')[0]; await waitFor(() => expect(lastName).toHaveFocus());
      expect(lastName).toHaveAttribute('aria-invalid', 'true');
      expect(first).toHaveValue('Ana'); expect(screen.getAllByLabelText('Número de documento')[0]).toHaveValue('1712345678'); // normalizado al enviar, sin perderlo
      await user.click(within(summary).getByRole('link', { name: 'Pasajero 2: Nombres' })); // el enlace del resumen lleva el foco al campo
      expect(screen.getAllByLabelText('Nombres')[1]).toHaveFocus();
    });

    it('PAS-15 cada error es texto con icono junto a su campo (no solo color), y al corregir todo se puede continuar al pago', async () => {
      const user = userEvent.setup(); open(undefined, true);
      await user.clear((await screen.findAllByLabelText('Apellidos'))[0]); await user.tab();
      const error = await screen.findByText(/Escribe los apellidos solo con letras/);
      expect(error.querySelector('svg')).not.toBeNull(); expect(error.textContent).not.toBe('');
      await user.type(screen.getAllByLabelText('Apellidos')[0], 'Pérez'); await user.tab();
      await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
      expect(await screen.findByRole('heading', { name: 'Pago' })).toBeInTheDocument();
    });

    it('PAS-16 errores del servidor en el almacén: se muestran en su campo y pasajero, enfocan el primero y se borran al editar ese campo', async () => {
      const user = userEvent.setup();
      open((store) => store.setServerErrors({ '1.firstName': 'Escribe los nombres solo con letras, espacios, apóstrofo, guion o punto (hasta 50 caracteres).', '0.phone': 'Escribe el teléfono con el código de país, por ejemplo +593987654321.' }), true);
      const phone = await screen.findByLabelText('Teléfono de contacto');
      await waitFor(() => expect(phone).toHaveFocus()); expect(phone).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getAllByLabelText('Nombres')[1]).toHaveAttribute('aria-invalid', 'true'); expect(screen.getAllByLabelText('Nombres')[1]).toHaveValue('Luis');
      expect(screen.getByRole('alert')).toHaveTextContent('Hay 2 campos por corregir');
      await user.clear(phone); await user.type(phone, '987654322'); expect(phone).not.toHaveAttribute('aria-invalid'); expect(screen.getByRole('alert')).toHaveTextContent('Hay 1 campo por corregir'); // el error del servidor se borra al editar el campo (y el número nuevo es válido para Ecuador)
    });
  });

  describe('fechas con rango, selector de país, teléfono y filtrado al escribir y al pegar (ADR-F12b1fix-05, puntos 6 a 9)', () => {
    const open = (patch: (store: PurchaseStore) => void = () => undefined, withPassengers = false) => {
      const started = startedPurchase({ withHold: true, withPassengers }); patch(started.purchase);
      renderApp('/compra/pasajeros', { session: signedIn(), purchase: started.purchase, handlers });
      return started.purchase;
    };
    /** Ayuda breve anunciada (región `status`) de ESE campo. */
    const live = (element: HTMLElement): string => document.getElementById(`${element.id}-live`)?.textContent ?? '';
    const nativeOf = (input: HTMLElement): HTMLInputElement | null | undefined => input.parentElement?.parentElement?.querySelector<HTMLInputElement>('input[type="date"]');
    const display = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    const birthRange = birthDateRange(); const expiry = (passport = false) => passport ? expiryRange() : expiryRange();

    it('PAS-17 fecha de nacimiento: se escribe y se muestra dd/mm/aaaa (con máscara), sale como AAAA-MM-DD y el calendario del navegador solo admite el rango', async () => {
      const user = userEvent.setup(); const purchase = open();
      const birth = (await screen.findAllByLabelText('Fecha de nacimiento'))[0];
      await user.type(birth, '14031990'); expect(birth).toHaveValue('14/03/1990'); expect(purchase.getState().drafts[0].birthDate).toBe('1990-03-14');
      expect(screen.getAllByText(`Formato dd/mm/aaaa, entre ${display(birthRange.min)} y ${display(birthRange.max)}.`).length).toBeGreaterThan(0);
      expect(nativeOf(birth)).toHaveAttribute('min', birthRange.min); expect(nativeOf(birth)).toHaveAttribute('max', birthRange.max); // el calendario del navegador solo deja elegir dentro del rango
      await user.clear(birth); await user.paste('1985-07-09'); expect(birth).toHaveValue('09/07/1985'); expect(purchase.getState().drafts[0].birthDate).toBe('1985-07-09'); // pegar «aaaa-mm-dd» también
    });

    it('PAS-18 fecha de nacimiento: una fecha fuera de rango (futura o de hace más de 125 años) o que no existe NO se acepta al escribir: queda vacía en el formulario y el campo explica el rango', async () => {
      const user = userEvent.setup(); const purchase = open();
      const birth = (await screen.findAllByLabelText('Fecha de nacimiento'))[0];
      const range = `La fecha debe estar entre ${display(birthRange.min)} y ${display(birthRange.max)}.`;
      await user.type(birth, `0101${new Date().getUTCFullYear() + 1}`); expect(purchase.getState().drafts[0].birthDate).toBe(''); expect(screen.getByText(range)).toBeInTheDocument(); expect(birth).toHaveAttribute('aria-invalid', 'true');
      await user.clear(birth); await user.type(birth, '01011800'); expect(purchase.getState().drafts[0].birthDate).toBe(''); expect(screen.getByText(range)).toBeInTheDocument();
      await user.clear(birth); await user.type(birth, '31022000'); expect(purchase.getState().drafts[0].birthDate).toBe(''); expect(screen.getByText('Esa fecha no existe. Escríbela como dd/mm/aaaa.')).toBeInTheDocument();
      await user.clear(birth); await user.type(birth, display(birthRange.min).replaceAll('/', '')); expect(purchase.getState().drafts[0].birthDate).toBe(birthRange.min); // el límite mismo sí vale
      await user.clear(birth); await user.type(birth, '1403'); await user.tab(); expect(screen.getByText('Escribe la fecha completa: dd/mm/aaaa.')).toBeInTheDocument();
    });

    it('PAS-19 fecha: las letras se bloquean con una ayuda anunciada; el vencimiento admite de hoy a 15 años y rechaza lo demás', async () => {
      const user = userEvent.setup(); const purchase = open();
      const birth = (await screen.findAllByLabelText('Fecha de nacimiento'))[0];
      await user.type(birth, '1a4'); expect(birth).toHaveValue('14'); expect(live(birth)).toBe('Solo números.');
      const expiryField = screen.getAllByLabelText(/Vencimiento del documento/)[0]; const { max } = expiry();
      await user.type(expiryField, '01012020'); expect(purchase.getState().drafts[0].documentExpiryDate).toBe(''); expect(screen.getAllByText(/La fecha debe estar entre/).length).toBeGreaterThan(0);
      await user.clear(expiryField); await user.type(expiryField, display(shiftYears(max, 1)).replaceAll('/', '')); expect(purchase.getState().drafts[0].documentExpiryDate).toBe('');
      await user.clear(expiryField); await user.type(expiryField, display(shiftYears(max, -5)).replaceAll('/', '')); expect(purchase.getState().drafts[0].documentExpiryDate).toBe(shiftYears(max, -5));
      expect(nativeOf(expiryField)).toHaveAttribute('max', max); expect(nativeOf(expiryField)).toHaveAttribute('min', expiryRange(new Date(), lastTravelDate([{ departureAt: '2026-12-10T13:35:00Z', departureIata: 'UIO', arrivalIata: 'GPS' }])).min);
    });

    it('PAS-20 nacionalidad: selector con búsqueda (sin tildes), banderas como imagen, teclado y código ISO-2 en el borrador', async () => {
      const user = userEvent.setup(); const purchase = open();
      const nationality = (await screen.findAllByLabelText('Nacionalidad'))[0];
      expect(nationality).toHaveAttribute('role', 'combobox'); expect(nationality).toHaveValue('Ecuador'); expect(nationality).toHaveAttribute('aria-expanded', 'false');
      await user.clear(nationality); await user.type(nationality, 'peru');
      const list = await screen.findByRole('listbox', { name: 'Nacionalidad' }); const options = within(list).getAllByRole('option');
      expect(options[0]).toHaveTextContent('Perú'); expect(options[0].querySelector('img')?.getAttribute('src')).toMatch(/pe\.svg/); expect(options[0].querySelector('img')).toHaveAttribute('alt', '');
      expect(nationality).toHaveAttribute('aria-expanded', 'true'); expect(nationality.getAttribute('aria-activedescendant')).toBe(options[0].id);
      await user.keyboard('{Enter}'); expect(purchase.getState().drafts[0].nationality).toBe('PE'); expect(nationality).toHaveValue('Perú'); expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      // Teclado: flechas, Escape (cierra y restaura) y búsqueda por código ISO.
      await user.click(nationality); await user.keyboard('{ArrowDown}{ArrowDown}{Escape}'); expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); expect(nationality).toHaveValue('Perú'); expect(purchase.getState().drafts[0].nationality).toBe('PE');
      await user.clear(nationality); await user.type(nationality, 'co'); expect(within(await screen.findByRole('listbox')).getAllByRole('option')[0]).toHaveTextContent('Colombia');
      await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: /Colombia/ })); expect(purchase.getState().drafts[0].nationality).toBe('CO');
      await user.clear(nationality); await user.type(nationality, 'zzzz'); expect(await screen.findByText('No encontramos ese país.')).toBeInTheDocument(); await user.keyboard('{Escape}');
    });

    it('PAS-21 teléfono: Ecuador por omisión con su bandera y +593; se elige el país por nombre o por código; el número es solo nacional y se compone el E.164 con y sin el 0 inicial', async () => {
      const user = userEvent.setup(); const purchase = open();
      const country = (await screen.findAllByLabelText('País del teléfono'))[0]; const phone = screen.getByLabelText('Teléfono de contacto');
      expect(country).toHaveValue('+593'); expect(described(country)).toContain('Ecuador'); expect(country.parentElement?.querySelector('img')?.getAttribute('src')).toMatch(/ec\.svg/);
      await user.type(phone, '0987654321'); expect(purchase.getState().drafts[0]).toMatchObject({ phoneCountry: 'EC', phoneNational: '0987654321' }); expect(draftPhone(purchase.getState().drafts[0])).toBe('+593987654321');
      await user.clear(phone); await user.type(phone, '987654321'); expect(draftPhone(purchase.getState().drafts[0])).toBe('+593987654321');
      await user.clear(country); await user.type(country, 'colom');
      const options = within(await screen.findByRole('listbox', { name: 'País del teléfono' })).getAllByRole('option'); expect(options[0]).toHaveTextContent('Colombia+57');
      await user.keyboard('{Enter}'); expect(country).toHaveValue('+57');
      expect(draftPhone(purchase.getState().drafts[0])).toBe(''); // 987654321 no es un número válido de Colombia: no se compone (la librería valida para el país elegido)
      await user.clear(phone); await user.type(phone, '3001234567'); expect(draftPhone(purchase.getState().drafts[0])).toBe('+573001234567');
      await user.clear(country); await user.type(country, '+593'); expect(within(await screen.findByRole('listbox')).getAllByRole('option')[0]).toHaveTextContent('Ecuador+593'); // por código de marcación
      await user.keyboard('{ArrowDown}{ArrowUp}{Enter}'); expect(country).toHaveValue('+593');
    });

    it('PAS-22 filtrado de nombres: al teclear y al pegar solo pasan letras (con tildes y ñ), espacios, apóstrofo, guion y punto; lo bloqueado se avisa (anunciado) y nunca se descarta en silencio', async () => {
      const user = userEvent.setup(); open();
      const first = (await screen.findAllByLabelText('Nombres'))[0];
      const help = 'Solo letras, espacios, apóstrofo, guion y punto.';
      await user.type(first, 'José Núñez'); expect(first).toHaveValue('José Núñez'); expect(live(first)).toBe(''); // nada bloqueado, nada que avisar
      await user.clear(first); await user.type(first, "O'Br1en@"); expect(first).toHaveValue("O'Bren"); // el 1 y la @ se bloquean y se avisa expect(live(first)).toBe(help);
      await user.clear(first); await user.paste('Ana 😀 María <b>'); expect(first).toHaveValue('Ana  María b'); expect(live(first)).toBe(help);
      await user.clear(first); await user.paste('a'.repeat(60)); expect(first).toHaveValue('a'.repeat(50)); expect(live(first)).toBe('Máximo 50 caracteres.');
      expect(document.getElementById(`${first.id}-live`)).toHaveAttribute('role', 'status'); // región anunciada a lectores de pantalla
      await user.tab(); expect(live(first)).toBe(''); // al salir del campo la ayuda se retira
    });

    it('PAS-23 composición de caracteres (tildes con tecla muerta, teclados móviles): durante la composición no se toca el valor; al terminar se filtra', async () => {
      open();
      const first = (await screen.findAllByLabelText('Nombres'))[0] as HTMLInputElement;
      fireEvent.compositionStart(first); fireEvent.change(first, { target: { value: '´' } }); expect(first).toHaveValue('´'); // símbolo a medias: se respeta mientras se compone
      fireEvent.change(first, { target: { value: 'é' } }); fireEvent.compositionEnd(first); expect(first).toHaveValue('é'); expect(live(first)).toBe('');
      fireEvent.compositionStart(first); fireEvent.change(first, { target: { value: 'é#' } }); fireEvent.compositionEnd(first); expect(first).toHaveValue('é'); expect(live(first)).toBe('Solo letras, espacios, apóstrofo, guion y punto.');
    });

    it('PAS-24 filtrado del teléfono y del documento según el tipo: solo números en el teléfono y en la cédula; pasaporte con letras y números en mayúsculas; el largo tiene tope y se avisa', async () => {
      const user = userEvent.setup(); const purchase = open();
      const phone = await screen.findByLabelText('Teléfono de contacto'); const document0 = screen.getAllByLabelText('Número de documento')[0]; const type = screen.getAllByLabelText('Tipo de documento')[0];
      await user.type(phone, '09a8-7'); expect(phone).toHaveValue('0987'); expect(live(phone)).toBe('Solo números.');
      await user.clear(phone); await user.paste('(098) 765 4321'); expect(phone).toHaveValue('0987654321'); expect(live(phone)).toBe('Solo números.'); // separadores pegados: se quitan y se AVISA
      await user.clear(phone); await user.paste('1'.repeat(20)); expect(phone).toHaveValue('1'.repeat(11)); expect(live(phone)).toBe('Máximo 11 caracteres.'); // el largo máximo de Ecuador según libphonenumber-js
      await user.type(document0, 'ab12-34'); expect(document0).toHaveValue('1234'); expect(live(document0)).toBe('Solo números.'); // cédula: solo dígitos
      await user.clear(document0); await user.paste('1'.repeat(25)); expect(document0).toHaveValue('1'.repeat(10)); expect(live(document0)).toBe('Máximo 10 caracteres.'); // cédula de Ecuador: 10
      await user.selectOptions(type, 'PASSPORT'); await user.clear(document0); await user.type(document0, 'ab12-ñ34'); expect(document0).toHaveValue('AB1234'); expect(live(document0)).toBe('Solo letras (sin tildes) y números.'); // pasaporte: mayúsculas, sin tilde ni ñ
      expect(purchase.getState().drafts[0].documentNumber).toBe('AB1234');
      await user.clear(document0); await user.paste('A'.repeat(25)); expect(document0).toHaveValue('A'.repeat(20)); expect(live(document0)).toBe('Máximo 20 caracteres.'); // pasaporte: 20
    });

    it('PAS-25 documento según tipo y nacionalidad: cédula de Ecuador, 10 números; cédula de otra nacionalidad, letras y números de 5 a 20; al cambiar el tipo o la nacionalidad se recalcula y se avisa', async () => {
      const user = userEvent.setup(); const purchase = open();
      const document0 = (await screen.findAllByLabelText('Número de documento'))[0]; const type = screen.getAllByLabelText('Tipo de documento')[0]; const nationality = screen.getAllByLabelText('Nacionalidad')[0];
      expect(described(document0)).toContain('Cédula ecuatoriana: 10 números.');
      await user.type(document0, '12345'); await user.tab(); expect(await screen.findByText('La cédula ecuatoriana lleva exactamente 10 números.')).toBeInTheDocument(); // 5 números: no basta para Ecuador
      // Nacionalidad distinta: la cédula admite letras y no exige 10; lo ya escrito (solo números) se queda y no se avisa.
      await user.click(nationality); await user.clear(nationality); await user.type(nationality, 'espa'); await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /España/ }));
      expect(purchase.getState().drafts[0].nationality).toBe('ES'); expect(document0).toHaveValue('12345'); expect(live(document0)).toBe('');
      expect(described(document0)).toContain('Letras y números, de 5 a 20.');
      await user.click(document0); await user.type(document0, 'z'); expect(document0).toHaveValue('12345Z'); expect(live(document0)).toBe(''); // el DNI español lleva letra: no se bloquea
      await user.tab(); expect(screen.queryByText('La cédula ecuatoriana lleva exactamente 10 números.')).not.toBeInTheDocument();
      // De vuelta a Ecuador: lo escrito se ajusta a la regla (sin la letra) y se avisa junto al campo, sin borrar lo demás.
      await user.click(nationality); await user.clear(nationality); await user.type(nationality, 'ecua'); await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: /Ecuador/ }));
      expect(purchase.getState().drafts[0].nationality).toBe('EC'); expect(document0).toHaveValue('12345'); expect(live(document0)).toBe('Ajustamos el número de documento a la regla elegida. Solo números.');
      // Cambiar el tipo recalcula igual: pasaporte de cualquier nacionalidad admite letras; volver a cédula de Ecuador quita las letras y avisa.
      await user.selectOptions(type, 'PASSPORT'); await user.click(document0); await user.type(document0, 'ab'); expect(document0).toHaveValue('12345AB');
      await user.selectOptions(type, 'NATIONAL_ID'); expect(document0).toHaveValue('12345'); expect(live(document0)).toBe('Ajustamos el número de documento a la regla elegida. Solo números.'); expect(purchase.getState().drafts[0].documentNumber).toBe('12345');
      await user.type(document0, '6'); expect(live(document0)).toBe(''); // al escribir en el campo el aviso se retira
    });
  });

  it('PAS-03 vuelo internacional ⇒ avisa que se exige pasaporte; un infante pide el adulto con el que viaja y no lleva asiento ni equipaje', async () => {
    const user = userEvent.setup();
    const international = { ...OFFER, itineraries: [itinerary({ id: 'it-1', flight: 'FP900', from: 'UIO', to: 'MAD', departure: '2026-12-10T22:00:00Z', arrival: '2026-12-11T10:00:00Z', minutes: 600 })] };
    const purchase = new PurchaseStore(memoryStore(), new IntentBook(counterIds())); purchase.start(international, BACK, { adults: 1, youths: 0, children: 0, infants: 1 }); purchase.setHold({ holdId: 'h-1', signature: 's' });
    renderApp('/compra/pasajeros', { session: signedIn(), purchase, handlers });
    expect(await screen.findByRole('heading', { name: 'Pasajero 2 · Infante' })).toBeInTheDocument();
    expect(screen.getByText('Viaja en brazos, sin asiento')).toBeInTheDocument();
    expect(screen.getAllByText('Equipaje adicional', { selector: 'strong' })).toHaveLength(1); // solo el adulto
    expect(screen.getByLabelText('Viaja con el adulto')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    expect(screen.getAllByText('Los vuelos internacionales requieren pasaporte.')).toHaveLength(2);
    expect(screen.getByText('Indica el adulto con el que viaja el infante.')).toBeInTheDocument();
  });

  it('PAS-04 con todos los datos válidos pasa al pago; el equipaje adicional se suma al resumen', async () => {
    const user = userEvent.setup();
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: { ...handlers, Hold: () => hold() } });
    await user.selectOptions(await screen.findByLabelText(/FP103 · maletas adicionales .* c\/u/, { selector: '#bag-0-it-1' }), '2');
    const aside = screen.getByRole('complementary', { name: 'Resumen de tu compra' });
    await waitFor(() => expect(aside).toHaveTextContent(/Equipaje adicional\s*USD 70,00/));
    expect(aside).toHaveTextContent(/Tarifas y tasas\s*USD 254,78/);
    await user.click(screen.getByRole('button', { name: 'Continuar al pago' }));
    expect(await screen.findByRole('heading', { name: 'Pago' })).toBeInTheDocument();
  });

  describe('maletas adicionales: solo lo que el servidor acepta (máximo total − incluidas en la tarifa)', () => {
    const TWO = { ...OFFER, itineraries: [itinerary({ id: 'it-1', flight: 'FP103', from: 'UIO', to: 'GPS', departure: '2026-12-10T13:35:00Z', arrival: '2026-12-10T16:30:00Z', minutes: 175, cabins: [['ECONOMY', 'Basic', '127.39', 9, 0], ['BUSINESS', 'Flex', '420.00', 9, 2]] })] };
    const started = (brand: 'Basic' | 'Flex') => {
      const purchase = new PurchaseStore(memoryStore(), new IntentBook(counterIds())); purchase.start(TWO, BACK, { adults: 1, youths: 0, children: 0, infants: 0 });
      if (brand === 'Flex') purchase.selectFare('it-1', { cabinClass: 'BUSINESS', fareBrand: 'Flex' });
      purchase.setHold({ holdId: 'h-1', signature: 's' });
      return purchase;
    };
    const options = (select: HTMLElement) => within(select).getAllByRole('option').map((option) => option.textContent);

    it('PAS-08 con BASIC (0 incluidas) ofrece el máximo (0 a 3); con FLEX (2 incluidas) no más de 1', async () => {
      renderApp('/compra/pasajeros', { session: signedIn(), purchase: started('Basic'), handlers });
      expect(options(await screen.findByLabelText(/FP103 · maletas adicionales/))).toEqual(['0', '1', '2', '3']);
    });
    it('PAS-09 con FLEX el selector ofrece solo 0 y 1 y lo explica; elegir 1 no da error', async () => {
      const user = userEvent.setup();
      renderApp('/compra/pasajeros', { session: signedIn(), purchase: started('Flex'), handlers });
      const select = await screen.findByLabelText(/FP103 · maletas adicionales/);
      expect(options(select)).toEqual(['0', '1']);
      expect(screen.getByText('Tu tarifa incluye 2 maletas facturadas; puedes agregar hasta 1.')).toBeInTheDocument();
      await user.selectOptions(select, '1'); expect(select).toHaveValue('1');
    });
    it('PAS-10 al cambiar de tarifa, una cantidad ya elegida que excede el nuevo máximo se ajusta y se avisa', async () => {
      const purchase = started('Basic'); purchase.setDrafts(purchase.getState().drafts.map((draft) => ({ ...draft, extraBaggage: { 'it-1': 3 } })));
      renderApp('/compra/pasajeros', { session: signedIn(), purchase, handlers });
      const select = await screen.findByLabelText(/FP103 · maletas adicionales/); expect(select).toHaveValue('3');
      expect(screen.queryByText('Ajustamos tus maletas adicionales.')).not.toBeInTheDocument();
      act(() => { purchase.selectFare('it-1', { cabinClass: 'BUSINESS', fareBrand: 'Flex' }); });
      expect(await screen.findByText('Ajustamos tus maletas adicionales.')).toBeInTheDocument();
      expect(screen.getByLabelText(/FP103 · maletas adicionales/)).toHaveValue('1');
      expect(purchase.getState().drafts[0].extraBaggage['it-1']).toBe(1);
    });
  });

  it('PAS-05 el contador sale del servidor: descuenta desde su remainingSeconds y, al llegar a cero, confirma con el servidor (410 ⇒ vencido, sin avanzar)', async () => {
    let calls = 0;
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: { Hold: () => { calls += 1; return calls === 1 ? hold({ remainingSeconds: 2 }) : gone(); } } });
    const timer = await screen.findByRole('timer', { name: 'Tiempo restante de tu selección' });
    expect(timer).toHaveTextContent(/^00:0[12]$/);
    expect(await screen.findByText('Tu selección venció.', undefined, { timeout: 6000 })).toBeInTheDocument();
    expect(calls).toBe(2); // al llegar a cero consultó de nuevo al servidor
    expect(screen.getByRole('link', { name: 'Volver a buscar' })).toHaveAttribute('href', BACK);
    expect(screen.getByRole('button', { name: 'Continuar al pago' })).toBeDisabled();
  });

  it('PAS-05b al llegar a cero NO se declara vencido hasta que el servidor lo confirma: si aún le queda tiempo, el contador sigue; si dice cero, vence sin repetir consultas', async () => {
    let calls = 0;
    const view = renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: { Hold: () => { calls += 1; return calls === 1 ? hold({ remainingSeconds: 1 }) : hold({ remainingSeconds: 45 }); } } });
    await screen.findByRole('timer', { name: 'Tiempo restante de tu selección' });
    await waitFor(() => expect(calls).toBe(2), { timeout: 6000 });
    expect(await screen.findByRole('timer', { name: 'Tiempo restante de tu selección' })).toHaveTextContent(/^0[01]:[0-5]\d$/); // volvió a contar desde lo que dijo el servidor
    expect(screen.queryByText('Tu selección venció.')).not.toBeInTheDocument();
    view.unmount();
    calls = 0;
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true, withPassengers: true }).purchase, handlers: { Hold: () => { calls += 1; return hold({ remainingSeconds: 0 }); } } });
    expect(await screen.findByText('Tu selección venció.', undefined, { timeout: 6000 })).toBeInTheDocument();
    expect(calls).toBe(2); // una consulta inicial y una de confirmación; no entra en bucle
  });

  it('PAS-06 si el reloj del dispositivo está mal, manda el servidor: remainingSeconds, no la hora local', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-01-01T00:00:00Z')); // reloj del dispositivo adelantado años
    renderApp('/compra/pasajeros', { session: signedIn(), purchase: startedPurchase({ withHold: true }).purchase, handlers: { Hold: () => hold({ remainingSeconds: 540 }) } });
    expect(await screen.findByRole('timer', { name: 'Tiempo restante de tu selección' })).toHaveTextContent('09:00');
  });

  it('PAS-07 una sesión vencida no pierde lo escrito: al volver a iniciar sesión el formulario conserva los datos', async () => {
    const user = userEvent.setup(); const session = signedIn();
    renderApp('/compra/pasajeros', { session, purchase: startedPurchase({ withHold: true }).purchase, handlers });
    await user.type((await screen.findAllByLabelText('Nombres'))[0], 'Ana');
    await user.type(screen.getAllByLabelText('Número de documento')[0], '1712345678');
    act(() => { session.set({ status: 'anonymous', expired: true }); });
    expect(await screen.findByRole('heading', { name: 'Tu sesión expiró' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('main')).getByRole('link', { name: 'Iniciar sesión' }));
    const main = within(screen.getByRole('main'));
    await user.type(main.getByLabelText('Correo electrónico'), customer.email ?? 'ana@example.test'); await user.type(main.getByLabelText('Contraseña'), 'clave-de-prueba-123');
    await user.click(main.getByRole('button', { name: 'Iniciar sesión' }));
    expect((await screen.findAllByLabelText('Nombres'))[0]).toHaveValue('Ana');
    expect(screen.getAllByLabelText('Número de documento')[0]).toHaveValue('1712345678');
  });
});
