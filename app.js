const supabaseClient = window.supabase.createClient(
  'https://jfudqokcjuvuzxgocddv.supabase.co',
  'sb_publishable_5o8803l0tNJa9jxtNs9tew_uhD1OoNM'
);

document.addEventListener('DOMContentLoaded', () => {
  // Estado global de configuración sincronizable con ESP32 / Supabase
  const configState = {
    plantName: 'Monstera Deliciosa',
    plantType: 'monstera',
    moistureThreshold: 40,
    waterVolumeMl: 250,
    pulseDurationSec: 15
  };

  // ==========================================================================
  // 1. NAVEGACIÓN ENTRE VISTAS (Inicio <-> Umbrales)
  // ==========================================================================
  const navTriggers = document.querySelectorAll('.nav-item, .nav-trigger');
  const views = document.querySelectorAll('.tab-view');

  function switchView(targetId, activeTrigger = null) {
    views.forEach((view) => {
      view.classList.toggle('active', view.id === `view-${targetId}`);
    });

    document.querySelectorAll('.nav-item').forEach((nav) => {
      const isTarget = activeTrigger
        ? nav === activeTrigger
        : nav.getAttribute('data-target') === targetId;
      nav.classList.toggle('active', isTarget);
      if (isTarget) {
        nav.setAttribute('aria-current', 'page');
      } else {
        nav.removeAttribute('aria-current');
      }
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  navTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      const target = trigger.getAttribute('data-target');
      if (target) {
        switchView(target, trigger.classList.contains('nav-item') ? trigger : null);
        const scrollTarget = trigger.getAttribute('data-scroll');
        if (scrollTarget) {
          requestAnimationFrame(() => {
            document.getElementById(scrollTarget)?.scrollIntoView({
              behavior: 'smooth',
              block: 'start'
            });
          });
        }
      }
    });
  });

  // ==========================================================================
  // 2. PANTALLA INICIO: Riego Manual y Sincronización
  // ==========================================================================
  const irrigateBtn = document.getElementById('irrigate-manual-btn');
  const btnIrrigateLabel = document.getElementById('btn-irrigate-label');
  const pumpStatusCard = document.getElementById('pump-status-card');
  const pumpTitle = document.getElementById('pump-title');
  const pumpDesc = document.getElementById('pump-desc');
  const pumpIndicatorLight = document.getElementById('pump-indicator-light');
  const pumpIndicatorText = document.getElementById('pump-indicator-text');

  let irrigationTimer = null;
  let orderStatusCheckInProgress = false;

  function stopIrrigation() {
    if (irrigationTimer) {
      clearInterval(irrigationTimer);
      irrigationTimer = null;
    }
    irrigateBtn.disabled = false;
    btnIrrigateLabel.textContent = `Activar riego manual (${configState.pulseDurationSec} seg)`;
    pumpStatusCard.classList.remove('irrigating-active');
    pumpTitle.textContent = 'Bomba en reposo';
    pumpDesc.textContent = `Lista para activarse si la humedad cae bajo ${configState.moistureThreshold}%`;
    pumpIndicatorLight.className = 'pump-dot';
    pumpIndicatorText.textContent = 'Standby';
  }

  async function checkIrrigationOrder(orderId) {
    if (orderStatusCheckInProgress) return;
    orderStatusCheckInProgress = true;

    try {
      const { data, error } = await supabaseClient
        .from('ordenes_riego')
        .select('estado, error')
        .eq('id', orderId)
        .maybeSingle();

      if (error) {
        console.error('Error al consultar el estado de la orden:', error);
        return;
      }

      if (!data) return;

      if (data.estado === 'procesando') {
        pumpStatusCard.classList.add('irrigating-active');
        pumpTitle.textContent = 'Riego en curso';
        pumpDesc.textContent = 'El ESP32 está ejecutando la orden.';
        pumpIndicatorLight.className = 'pump-dot active-ping';
        pumpIndicatorText.textContent = 'Regando';
        if (btnIrrigateLabel) btnIrrigateLabel.textContent = 'Riego en curso...';
      } else if (data.estado === 'completada') {
        stopIrrigation();
        showToast('Riego completado', 'El ESP32 confirmó que terminó el riego.');
        await cargarEventosRiego();
      } else if (data.estado === 'fallida' || data.estado === 'expirada') {
        stopIrrigation();
        pumpTitle.textContent = data.estado === 'expirada' ? 'Orden expirada' : 'Riego no completado';
        pumpDesc.textContent = data.error || 'El ESP32 no pudo completar la orden.';
        showToast('Orden de riego no completada', pumpDesc.textContent);
      }
    } finally {
      orderStatusCheckInProgress = false;
    }
  }

  function seguirOrdenRiego(orderId, state = 'pendiente') {
    irrigateBtn.disabled = true;
    pumpStatusCard.classList.toggle('irrigating-active', state === 'procesando');
    pumpTitle.textContent = state === 'procesando'
      ? 'Riego en curso'
      : 'Orden de riego pendiente';
    pumpDesc.textContent = state === 'procesando'
      ? 'El ESP32 está ejecutando la orden.'
      : 'Guardada en Supabase; esperando que el ESP32 la consulte.';
    pumpIndicatorLight.className = state === 'procesando'
      ? 'pump-dot active-ping'
      : 'pump-dot';
    pumpIndicatorText.textContent = state === 'procesando' ? 'Regando' : 'En cola';
    if (btnIrrigateLabel) {
      btnIrrigateLabel.textContent = state === 'procesando'
        ? 'Riego en curso...'
        : 'Esperando al ESP32...';
    }

    irrigationTimer = setInterval(() => checkIrrigationOrder(orderId), 2000);
    checkIrrigationOrder(orderId);
  }

  async function cargarOrdenActiva() {
    let activeOrderFound = false;
    irrigateBtn.disabled = true;
    if (btnIrrigateLabel) btnIrrigateLabel.textContent = 'Verificando órdenes...';

    try {
      const { data, error } = await supabaseClient
        .from('ordenes_riego')
        .select('id, estado')
        .eq('dispositivo', 'ESP32_RIEGO_01')
        .in('estado', ['pendiente', 'procesando'])
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error al consultar órdenes activas:', error);
        return;
      }

      if (data) {
        activeOrderFound = true;
        seguirOrdenRiego(data.id, data.estado);
      }
    } catch (error) {
      console.error('Error de red consultando órdenes activas:', error);
    } finally {
      if (!activeOrderFound && !irrigationTimer) {
        irrigateBtn.disabled = false;
        if (btnIrrigateLabel) {
          btnIrrigateLabel.textContent = `Activar riego manual (${configState.pulseDurationSec} seg)`;
        }
      }
    }
  }

  if (irrigateBtn) {
    irrigateBtn.addEventListener('click', async () => {
      irrigateBtn.disabled = true;
      if (btnIrrigateLabel) btnIrrigateLabel.textContent = 'Enviando orden a Supabase...';

      try {
        const { data, error } = await supabaseClient
          .from('ordenes_riego')
          .insert({
            accion: 'regar',
            duracion_seg: configState.pulseDurationSec,
            volumen_ml: configState.waterVolumeMl,
            dispositivo: 'ESP32_RIEGO_01'
          })
          .select('id')
          .single();

        if (error) {
          throw error;
        }

        seguirOrdenRiego(data.id);
      } catch (error) {
        console.error('No se pudo guardar la orden de riego en Supabase:', error);
        irrigateBtn.disabled = false;
        if (btnIrrigateLabel) {
          btnIrrigateLabel.textContent = `Activar riego manual (${configState.pulseDurationSec} seg)`;
        }
        showToast(
          'No se pudo enviar la orden',
          'Verifica la tabla ordenes_riego, sus permisos y las políticas RLS.'
        );
      }
    });
  }

  const syncBtn = document.getElementById('refresh-btn');
  const syncTimerText = document.getElementById('sync-timer');
  const connectionStatus = document.getElementById('connection-status');
  const connectionStatusText = document.getElementById('connection-status-text');
  const sensorStatusTitle = document.getElementById('sensor-status-title');
  const hardwareBanner = document.getElementById('diagnostico-section');
  const sensorPulse = document.querySelector('.ping-wrapper-lg .ping-circle');
  const sensorDot = document.querySelector('.ping-wrapper-lg .ping-dot-lg');
  let readingSyncInProgress = false;

  function setSensorConnection(state, title, detail) {
    if (connectionStatus) {
      connectionStatus.classList.toggle('connection-online', state === 'online');
      connectionStatus.classList.toggle('connection-stale', state === 'stale');
      connectionStatus.classList.toggle('connection-error', state === 'error');
    }
    if (hardwareBanner) {
      hardwareBanner.classList.toggle('connection-online', state === 'online');
      hardwareBanner.classList.toggle('connection-stale', state === 'stale');
      hardwareBanner.classList.toggle('connection-error', state === 'error');
    }
    if (sensorDot) {
      sensorDot.classList.toggle('connection-stale', state === 'stale');
      sensorDot.classList.toggle('connection-error', state === 'error');
    }

    if (connectionStatusText) connectionStatusText.textContent = title;
    if (sensorStatusTitle) sensorStatusTitle.textContent = title;
    if (syncTimerText && detail) syncTimerText.textContent = detail;
    if (sensorPulse) sensorPulse.hidden = state !== 'online';
  }

  function renderChartThreshold() {
    const thresholdLine = document.getElementById('chart-threshold-line');
    const thresholdText = document.getElementById('svg-threshold-text');
    const y = 95 - (configState.moistureThreshold / 100) * 90;

    if (thresholdLine) {
      thresholdLine.setAttribute('y1', y.toFixed(1));
      thresholdLine.setAttribute('y2', y.toFixed(1));
    }
    if (thresholdText) {
      thresholdText.setAttribute('y', Math.max(10, y - 3).toFixed(1));
      thresholdText.textContent = `Umbral ${configState.moistureThreshold}%`;
    }
  }

  async function sincronizarUltimaLectura(showError = false) {
    if (readingSyncInProgress) return;
    readingSyncInProgress = true;

    try {
      const { data, error } = await supabaseClient
        .from('lecturas_humedad')
        .select('humedad_porcentaje, registrado_en')
        .order('registrado_en', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error al consultar la humedad en Supabase:', error);
        setSensorConnection('error', 'Error al leer Supabase', 'No se pudo consultar la última lectura.');
        if (showError) {
          showToast('Error de sincronización', 'No se pudo consultar la humedad.');
        }
        return;
      }

      if (!data) {
        window.limpiarHumedadUI();
        setSensorConnection('stale', 'Sin lecturas del sensor', 'No hay lecturas guardadas todavía.');
        return;
      }

      window.actualizarHumedadUI(Number(data.humedad_porcentaje));
      const date = new Date(data.registrado_en);
      const ageMs = Date.now() - date.getTime();
      const isFresh = Number.isFinite(ageMs) && ageMs >= -60000 && ageMs <= 30000;
      const detail = Number.isFinite(date.getTime())
        ? `Última lectura: ${date.toLocaleString()}`
        : 'Lectura recibida; fecha no válida.';
      setSensorConnection(
        isFresh ? 'online' : 'stale',
        isFresh ? 'Sensor activo' : 'Sin datos recientes',
        detail
      );
    } catch (error) {
      console.error('Error de red consultando la humedad:', error);
      setSensorConnection('error', 'Error al leer Supabase', 'No se pudo consultar la última lectura.');
      if (showError) {
        showToast('Error de sincronización', 'No se pudo consultar la humedad.');
      }
    } finally {
      readingSyncInProgress = false;
    }
  }

  let historyLoadInProgress = false;

  async function cargarHistorial() {
    if (historyLoadInProgress) return;
    historyLoadInProgress = true;

    try {
      const { data, error } = await supabaseClient
        .from('lecturas_humedad')
        .select('humedad_porcentaje, registrado_en')
        .order('registrado_en', { ascending: false })
        .limit(60);

      if (error) {
        console.error('Error al cargar historial de humedad:', error);
        const chartValue = document.getElementById('chart-current-value');
        if (chartValue) chartValue.textContent = 'No se pudo cargar el historial';
        return;
      }

      renderMoistureHistory(data || []);
    } catch (error) {
      console.error('Error de red cargando historial de humedad:', error);
    } finally {
      historyLoadInProgress = false;
    }
  }

  function renderMoistureHistory(rows) {
    const linePath = document.getElementById('chart-line-path');
    const areaPath = document.getElementById('chart-area-path');
    const lastPoint = document.getElementById('chart-last-point');
    const chartValue = document.getElementById('chart-current-value');
    const oldestLabel = document.getElementById('chart-oldest-label');
    const latestLabel = document.getElementById('chart-latest-label');

    const readings = rows.slice().reverse();
    if (!readings.length) {
      if (linePath) linePath.setAttribute('d', '');
      if (areaPath) areaPath.setAttribute('d', '');
      if (lastPoint) lastPoint.setAttribute('visibility', 'hidden');
      if (chartValue) chartValue.textContent = 'Sin lecturas todavía';
      if (oldestLabel) oldestLabel.textContent = 'Más antigua';
      if (latestLabel) latestLabel.textContent = 'Más reciente';
      return;
    }

    const points = readings.map((reading, index) => {
      const value = Math.max(0, Math.min(100, Number(reading.humedad_porcentaje)));
      const x = readings.length === 1 ? 160 : (index / (readings.length - 1)) * 320;
      const y = 95 - (value / 100) * 90;
      return { x, y, value, timestamp: reading.registrado_en };
    }).filter((point) => Number.isFinite(point.value));

    if (!points.length) return;

    const line = points.map((point, index) =>
      `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    ).join(' ');
    const first = points[0];
    const last = points[points.length - 1];
    const area = `${line} L ${last.x.toFixed(1)} 100 L ${first.x.toFixed(1)} 100 Z`;

    if (linePath) linePath.setAttribute('d', line);
    if (areaPath) areaPath.setAttribute('d', area);
    if (lastPoint) {
      lastPoint.setAttribute('cx', last.x.toFixed(1));
      lastPoint.setAttribute('cy', last.y.toFixed(1));
      lastPoint.setAttribute('visibility', 'visible');
    }
    if (chartValue) chartValue.textContent = `Lectura actual: ${last.value}%`;
    if (oldestLabel) {
      oldestLabel.textContent = new Date(first.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    }
    if (latestLabel) {
      latestLabel.textContent = new Date(last.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      });
    }
  }

  let eventsLoadInProgress = false;

  async function cargarEventosRiego() {
    if (eventsLoadInProgress) return;
    eventsLoadInProgress = true;

    try {
      const { data, error } = await supabaseClient
        .from('eventos_riego')
        .select('tipo, volumen_ml, duracion_seg, iniciado_en')
        .order('iniciado_en', { ascending: false })
        .limit(5);

      if (error) {
        console.error('Error al cargar eventos de riego:', error);
        return;
      }

      renderEventosRiego(data || []);
    } catch (error) {
      console.error('Error de red cargando eventos de riego:', error);
    } finally {
      eventsLoadInProgress = false;
    }
  }

  function renderEventosRiego(events) {
    const items = document.getElementById('events-items');
    const emptyState = document.getElementById('events-empty');
    const lastWateringTime = document.getElementById('last-watering-time');
    const lastWaterMl = document.getElementById('last-water-ml');

    if (!items) return;
    items.replaceChildren();

    if (!events.length) {
      if (emptyState) {
        emptyState.hidden = false;
        emptyState.textContent = 'Aún no hay riegos registrados.';
      }
      if (lastWateringTime) lastWateringTime.textContent = 'Sin riegos registrados';
      if (lastWaterMl) lastWaterMl.textContent = '-- ml';
      return;
    }

    if (emptyState) emptyState.hidden = true;
    const latestWatering = events.find((event) =>
      event.tipo === 'manual' || event.tipo === 'automatico'
    );
    if (lastWateringTime) {
      lastWateringTime.textContent = latestWatering
        ? `Último riego: ${new Date(latestWatering.iniciado_en).toLocaleString()}`
        : 'Sin riegos registrados';
    }
    if (lastWaterMl) {
      lastWaterMl.textContent = !latestWatering || latestWatering.volumen_ml == null
        ? '-- ml'
        : `${latestWatering.volumen_ml} ml`;
    }

    events.forEach((event) => {
      const item = document.createElement('div');
      item.className = 'event-item';

      const iconBox = document.createElement('div');
      iconBox.className = 'event-icon bg-sec-fixed text-secondary';
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined icon-sm';
      icon.textContent = event.tipo === 'detenido' ? 'stop_circle' : 'water_drop';
      iconBox.append(icon);

      const content = document.createElement('div');
      content.className = 'event-content';
      const title = document.createElement('span');
      title.className = 'event-title';
      title.textContent = {
        manual: 'Riego manual',
        automatico: 'Riego automático',
        detenido: 'Riego detenido'
      }[event.tipo] || 'Evento de riego';

      const meta = document.createElement('span');
      meta.className = 'event-meta';
      const details = [];
      if (event.duracion_seg != null) details.push(`${event.duracion_seg} s`);
      if (event.volumen_ml != null) details.push(`${event.volumen_ml} ml`);
      details.push(new Date(event.iniciado_en).toLocaleString());
      meta.textContent = details.join(' · ');

      content.append(title, meta);
      item.append(iconBox, content);
      items.append(item);
    });
  }

  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      const icon = syncBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.classList.add('animate-spin');

      try {
        await Promise.all([
          sincronizarUltimaLectura(true),
          cargarHistorial(),
          cargarEventosRiego()
        ]);
      } finally {
        if (icon) icon.classList.remove('animate-spin');
      }
    });
  }

  // ==========================================================================
  // 3. PANTALLA UMBRALES: Slider, Perfiles Botánicos y Steppers
  // ==========================================================================
  const moistureSlider = document.getElementById('moisture-slider');
  const moistureDisplay = document.getElementById('moisture-display');
  const scaleZoneLabel = document.getElementById('scale-zone-label');
  const presetChips = document.querySelectorAll('.preset-chip');
  const moistureStatusPill = document.getElementById('moisture-status-pill');
  const moistureStatusText = document.getElementById('moisture-status-text');
  const moistureZoneSegments = document.querySelectorAll('.zones-bar .zone-seg');
  let currentMoisture = null;

  function updateDashboardMoistureStatus() {
    if (currentMoisture === null) {
      if (moistureStatusText) moistureStatusText.textContent = 'Esperando lectura del sensor';
      if (moistureStatusPill) {
        moistureStatusPill.classList.remove('status-pill-optimal', 'status-pill-needs-water');
        moistureStatusPill.classList.add('status-pill-neutral');
      }
      moistureZoneSegments.forEach((segment) => segment.classList.remove('active-zone'));
      return;
    }

    const needsWater = currentMoisture < configState.moistureThreshold;
    const zoneIndex = currentMoisture < 20 ? 0
      : currentMoisture < 40 ? 1
        : currentMoisture <= 60 ? 2
          : currentMoisture <= 80 ? 3
            : 4;

    if (moistureStatusText) {
      moistureStatusText.textContent = needsWater
        ? `Bajo umbral (${configState.moistureThreshold}%) • Requiere riego`
        : `Sobre umbral (${configState.moistureThreshold}%) • Nivel suficiente`;
    }

    if (moistureStatusPill) {
      moistureStatusPill.classList.toggle('status-pill-needs-water', needsWater);
      moistureStatusPill.classList.toggle('status-pill-optimal', !needsWater);
      moistureStatusPill.classList.remove('status-pill-neutral');
    }

    moistureZoneSegments.forEach((segment, index) => {
      segment.classList.toggle('active-zone', index === zoneIndex);
    });
  }

  updateDashboardMoistureStatus();

  function getZoneDescription(val) {
    if (val < 20) return 'Muy Seco (<20%)';
    if (val < 40) return 'Seco (20-40%)';
    if (val <= 60) return 'Medio (40-60%)';
    if (val <= 80) return 'Húmedo (60-80%)';
    return 'Muy Húmedo (>80%)';
  }

  function updateMoistureThreshold(val) {
    configState.moistureThreshold = parseInt(val, 10);
    if (moistureSlider) moistureSlider.value = configState.moistureThreshold;
    if (moistureDisplay) moistureDisplay.textContent = `${configState.moistureThreshold}%`;
    if (scaleZoneLabel) scaleZoneLabel.textContent = getZoneDescription(configState.moistureThreshold);

    const chartThresholdLabel = document.getElementById('chart-threshold-label');
    if (chartThresholdLabel) chartThresholdLabel.textContent = configState.moistureThreshold;
    renderChartThreshold();
    if (!irrigationTimer && pumpDesc) {
      pumpDesc.textContent = `Lista para activarse si la humedad cae bajo ${configState.moistureThreshold}%`;
    }
    updateDashboardMoistureStatus();

    presetChips.forEach((chip) => {
      chip.classList.toggle('active', Number(chip.getAttribute('data-val')) === configState.moistureThreshold);
    });
  }

  if (moistureSlider) {
    moistureSlider.addEventListener('input', (e) => {
      updateMoistureThreshold(e.target.value);
    });
  }

  // Perfiles Botánicos Rápidos
  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const targetVal = chip.getAttribute('data-val');
      updateMoistureThreshold(targetVal);
    });
  });

  // Stepper: Agua a suministrar (ml)
  const volMinus = document.getElementById('vol-minus');
  const volPlus = document.getElementById('vol-plus');
  const volumeValEl = document.getElementById('volume-val');

  function updateVolume(delta) {
    configState.waterVolumeMl = Math.max(50, Math.min(2000, configState.waterVolumeMl + delta));
    if (volumeValEl) volumeValEl.textContent = `${configState.waterVolumeMl} ml`;
  }

  if (volMinus) volMinus.addEventListener('click', () => updateVolume(-50));
  if (volPlus) volPlus.addEventListener('click', () => updateVolume(50));

  // Stepper: Dosificación por ciclo (seg)
  const durMinus = document.getElementById('dur-minus');
  const durPlus = document.getElementById('dur-plus');
  const durationValEl = document.getElementById('duration-val');

  function updateDuration(delta) {
    configState.pulseDurationSec = Math.max(5, Math.min(60, configState.pulseDurationSec + delta));
    if (durationValEl) durationValEl.textContent = `${configState.pulseDurationSec} seg`;
    if (!irrigationTimer && btnIrrigateLabel) {
      btnIrrigateLabel.textContent = `Activar riego manual (${configState.pulseDurationSec} seg)`;
    }
  }

  if (durMinus) durMinus.addEventListener('click', () => updateDuration(-1));
  if (durPlus) durPlus.addEventListener('click', () => updateDuration(1));

  // ==========================================================================
  // 4. GUARDAR CONFIGURACIÓN, RESET Y TOAST
  // ==========================================================================
  const toastEl = document.getElementById('toast-esp32');
  const toastTitle = document.getElementById('toast-title');
  const toastSubtitle = document.getElementById('toast-subtitle');
  const toastCloseBtn = document.getElementById('toast-close-btn');
  const btnSaveEsp32 = document.getElementById('btn-save-esp32');
  const btnResetDefaults = document.getElementById('btn-reset-defaults');
  const plantNameInput = document.getElementById('plant-name-input');
  const plantTypeSelect = document.getElementById('plant-type-select');

  let toastTimeout = null;

  function showToast(title, subtitle) {
    if (!toastEl) return;
    if (toastTitle) toastTitle.textContent = title;
    if (toastSubtitle) toastSubtitle.textContent = subtitle;

    toastEl.classList.add('visible');
    toastEl.setAttribute('aria-hidden', 'false');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(closeToast, 3500);
  }

  function closeToast() {
    if (toastEl) {
      toastEl.classList.remove('visible');
      toastEl.setAttribute('aria-hidden', 'true');
    }
  }

  if (toastCloseBtn) toastCloseBtn.addEventListener('click', closeToast);

  let configuracionId = null;

  async function cargarConfiguracion() {
    try {
      const { data, error } = await supabaseClient
        .from('configuracion_riego')
        .select('*')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error al cargar configuración de Supabase:', error);
        showToast('Error de conexión', 'No se pudo leer la configuración.');
        return;
      }

      if (!data) {
        showToast('Sin configuración', 'No se encontró una fila de configuración.');
        return;
      }

      configuracionId = data.id;
      configState.plantName = data.nombre_planta;
      configState.plantType = data.tipo_planta;
      configState.waterVolumeMl = data.volumen_agua_ml;
      configState.pulseDurationSec = data.duracion_pulso_seg;

      if (plantNameInput) plantNameInput.value = data.nombre_planta;
      if (plantTypeSelect) plantTypeSelect.value = data.tipo_planta;
      updateMoistureThreshold(data.umbral_humedad);

      if (volumeValEl) volumeValEl.textContent = `${data.volumen_agua_ml} ml`;
      if (durationValEl) durationValEl.textContent = `${data.duracion_pulso_seg} seg`;

      const dashboardName = document.getElementById('dashboard-plant-name');
      if (dashboardName) dashboardName.textContent = data.nombre_planta;
      if (!irrigationTimer && btnIrrigateLabel) {
        btnIrrigateLabel.textContent = `Activar riego manual (${data.duracion_pulso_seg} seg)`;
      }
    } catch (error) {
      console.error('Error de red cargando configuración:', error);
      showToast('Error de conexión', 'No se pudo leer la configuración.');
    }
  }

  async function guardarConfiguracion() {
    if (!configuracionId) {
      showToast('No se guardó', 'No se pudo identificar la configuración.');
      return false;
    }

    if (plantNameInput) {
      configState.plantName = plantNameInput.value.trim() || 'Planta Zona 1';
    }
    if (plantTypeSelect) {
      configState.plantType = plantTypeSelect.value;
    }

    if (btnSaveEsp32) btnSaveEsp32.disabled = true;
    if (btnResetDefaults) btnResetDefaults.disabled = true;

    try {
      const { error } = await supabaseClient
        .from('configuracion_riego')
        .update({
          nombre_planta: configState.plantName,
          tipo_planta: configState.plantType,
          umbral_humedad: configState.moistureThreshold,
          volumen_agua_ml: configState.waterVolumeMl,
          duracion_pulso_seg: configState.pulseDurationSec
        })
        .eq('id', configuracionId);

      if (error) {
        console.error('Error al guardar configuración en Supabase:', error);
        showToast('Error al guardar', 'Supabase no pudo actualizar la configuración.');
        return false;
      }

      const dashboardName = document.getElementById('dashboard-plant-name');
      if (dashboardName) dashboardName.textContent = configState.plantName;
      showToast('Configuración guardada', 'Los cambios se guardaron en Supabase.');
      return true;
    } catch (error) {
      console.error('Error de red guardando configuración:', error);
      showToast('Error al guardar', 'No se pudo conectar con Supabase.');
      return false;
    } finally {
      if (btnSaveEsp32) btnSaveEsp32.disabled = false;
      if (btnResetDefaults) btnResetDefaults.disabled = false;
    }
  }

  if (btnSaveEsp32) {
    btnSaveEsp32.addEventListener('click', guardarConfiguracion);
  }

  if (btnResetDefaults) {
    btnResetDefaults.addEventListener('click', async () => {
      if (plantNameInput) plantNameInput.value = 'Monstera Deliciosa';
      if (plantTypeSelect) plantTypeSelect.value = 'monstera';

      configState.plantName = 'Monstera Deliciosa';
      configState.plantType = 'monstera';

      updateMoistureThreshold(40);
      configState.waterVolumeMl = 250;
      if (volumeValEl) volumeValEl.textContent = '250 ml';
      configState.pulseDurationSec = 15;
      if (durationValEl) durationValEl.textContent = '15 seg';
      if (!irrigationTimer && btnIrrigateLabel) {
        btnIrrigateLabel.textContent = 'Activar riego manual (15 seg)';
      }

      await guardarConfiguracion();
    });
  }

  // ==========================================================================
  // 5. HELPER GLOBAL PARA TELEMETRÍA EN VIVO (ESP32 / SUPABASE)
  // ==========================================================================
  window.actualizarHumedadUI = function (porcentaje) {
    const reading = Number(porcentaje);
    if (!Number.isFinite(reading)) {
      console.error('Lectura de humedad inválida:', porcentaje);
      return;
    }

    const clamped = Math.max(0, Math.min(100, reading));
    currentMoisture = clamped;
    const moistureValEl = document.getElementById('moisture-val');
    const gaugeArc = document.getElementById('gauge-arc');
    const chartCurrentValue = document.getElementById('chart-current-value');

    if (moistureValEl) moistureValEl.textContent = clamped;
    if (chartCurrentValue) chartCurrentValue.textContent = `Lectura actual: ${clamped}%`;
    if (gaugeArc) {
      const maxDash = 251.3;
      const offset = maxDash - (clamped / 100) * maxDash;
      gaugeArc.style.strokeDashoffset = offset.toFixed(1);
    }
    updateDashboardMoistureStatus();
  };

  window.limpiarHumedadUI = function () {
    currentMoisture = null;
    const moistureValEl = document.getElementById('moisture-val');
    const gaugeArc = document.getElementById('gauge-arc');

    if (moistureValEl) moistureValEl.textContent = '--';
    if (gaugeArc) gaugeArc.style.strokeDashoffset = '251.3';
    updateDashboardMoistureStatus();
  };

  cargarConfiguracion();
  sincronizarUltimaLectura();
  cargarHistorial();
  cargarEventosRiego();
  cargarOrdenActiva();
  setInterval(() => sincronizarUltimaLectura(), 5000);
  setInterval(() => {
    cargarHistorial();
    cargarEventosRiego();
  }, 60000);
});