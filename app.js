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

  if (irrigateBtn) {
    irrigateBtn.addEventListener('click', () => {
      let secondsLeft = configState.pulseDurationSec;
      irrigateBtn.disabled = true;
      pumpStatusCard.classList.add('irrigating-active');

      pumpTitle.textContent = 'Bomba activa (Regando)';
      pumpDesc.textContent = 'Flujo de agua a 1.2 L/min hacia sustrato HW-080';
      pumpIndicatorLight.className = 'pump-dot active-ping';
      pumpIndicatorText.textContent = 'Riego activo';
      btnIrrigateLabel.textContent = `Regando... (${secondsLeft}s restantes)`;

      irrigationTimer = setInterval(() => {
        secondsLeft--;
        if (secondsLeft > 0) {
          btnIrrigateLabel.textContent = `Regando... (${secondsLeft}s restantes)`;
        } else {
          stopIrrigation();
        }
      }, 1000);
    });
  }

  // Botones de sincronización (Header y Banner)
  const syncBtns = [
    document.getElementById('refresh-btn'),
    document.getElementById('header-sync-btn')
  ];
  const syncTimerText = document.getElementById('sync-timer');

  syncBtns.forEach((btn) => {
    if (!btn) return;
    btn.addEventListener('click', () => {
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) icon.classList.add('animate-spin');

      setTimeout(() => {
        if (icon) icon.classList.remove('animate-spin');
        if (syncTimerText) syncTimerText.textContent = 'Última sincronización: Hace 1 seg';
      }, 700);
    });
  });

  // ==========================================================================
  // 3. PANTALLA UMBRALES: Slider, Perfiles Botánicos y Steppers
  // ==========================================================================
  const moistureSlider = document.getElementById('moisture-slider');
  const moistureDisplay = document.getElementById('moisture-display');
  const scaleZoneLabel = document.getElementById('scale-zone-label');
  const presetChips = document.querySelectorAll('.preset-chip');

  function getZoneDescription(val) {
    if (val < 20) return 'Muy Seco (<20%)';
    if (val < 40) return 'Seco (20-40%)';
    if (val <= 60) return 'Medio (40-60%)';
    if (val <= 80) return 'Húmedo (60-80%)';
    return 'Muy Húmedo (>80%)';
  }

  function updateMoistureThreshold(val, fromPreset = false) {
    configState.moistureThreshold = parseInt(val, 10);
    if (moistureSlider) moistureSlider.value = configState.moistureThreshold;
    if (moistureDisplay) moistureDisplay.textContent = `${configState.moistureThreshold}%`;
    if (scaleZoneLabel) scaleZoneLabel.textContent = getZoneDescription(configState.moistureThreshold);

    // Actualizar referencias en el Panel Principal
    const chartThresholdLabel = document.getElementById('chart-threshold-label');
    const svgThresholdText = document.getElementById('svg-threshold-text');
    if (chartThresholdLabel) chartThresholdLabel.textContent = configState.moistureThreshold;
    if (svgThresholdText) svgThresholdText.textContent = `Umbral ${configState.moistureThreshold}%`;
    if (!irrigationTimer && pumpDesc) {
      pumpDesc.textContent = `Lista para activarse si la humedad cae bajo ${configState.moistureThreshold}%`;
    }

    if (!fromPreset) {
      presetChips.forEach((chip) => chip.classList.remove('active'));
    }
  }

  if (moistureSlider) {
    moistureSlider.addEventListener('input', (e) => {
      updateMoistureThreshold(e.target.value, false);
    });
  }

  // Perfiles Botánicos Rápidos
  presetChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const targetVal = chip.getAttribute('data-val');
      presetChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      updateMoistureThreshold(targetVal, true);
    });
  });

  // Stepper: Agua a suministrar (ml)
  const volMinus = document.getElementById('vol-minus');
  const volPlus = document.getElementById('vol-plus');
  const volumeValEl = document.getElementById('volume-val');

  function updateVolume(delta) {
    configState.waterVolumeMl = Math.max(50, Math.min(2000, configState.waterVolumeMl + delta));
    if (volumeValEl) volumeValEl.textContent = `${configState.waterVolumeMl} ml`;
    const lastWaterMl = document.getElementById('last-water-ml');
    if (lastWaterMl) lastWaterMl.textContent = `${configState.waterVolumeMl} ml`;
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
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(closeToast, 3500);
  }

  function closeToast() {
    if (toastEl) toastEl.classList.remove('visible');
  }

  if (toastCloseBtn) toastCloseBtn.addEventListener('click', closeToast);

  if (btnSaveEsp32) {
    btnSaveEsp32.addEventListener('click', () => {
      if (plantNameInput) {
        configState.plantName = plantNameInput.value.trim() || 'Planta Zona 1';
        const dashPlantName = document.getElementById('dashboard-plant-name');
        if (dashPlantName) dashPlantName.textContent = configState.plantName;
      }
      if (plantTypeSelect) {
        configState.plantType = plantTypeSelect.value;
      }

      // Aquí irá tu llamada fetch() / Supabase update con configState
      console.log('Configuración lista para enviar al ESP32:', configState);

      showToast(
        'Parámetros sincronizados',
        'Flash EEPROM del ESP32 actualizada con éxito.'
      );
    });
  }

  if (btnResetDefaults) {
    btnResetDefaults.addEventListener('click', () => {
      if (plantNameInput) plantNameInput.value = 'Monstera Deliciosa';
      if (plantTypeSelect) plantTypeSelect.value = 'monstera';

      presetChips.forEach((c) => {
        c.classList.toggle('active', c.getAttribute('data-preset') === 'monstera');
      });

      configState.plantName = 'Monstera Deliciosa';
      configState.plantType = 'monstera';
      const dashPlantName = document.getElementById('dashboard-plant-name');
      if (dashPlantName) dashPlantName.textContent = configState.plantName;

      updateMoistureThreshold(40, true);
      configState.waterVolumeMl = 250;
      if (volumeValEl) volumeValEl.textContent = '250 ml';
      const lastWaterMl = document.getElementById('last-water-ml');
      if (lastWaterMl) lastWaterMl.textContent = '250 ml';
      configState.pulseDurationSec = 15;
      if (durationValEl) durationValEl.textContent = '15 seg';
      if (!irrigationTimer && btnIrrigateLabel) {
        btnIrrigateLabel.textContent = 'Activar riego manual (15 seg)';
      }

      showToast(
        'Valores por defecto cargados',
        'Configuración restablecida a parámetros de fábrica.'
      );
    });
  }

  // ==========================================================================
  // 5. HELPER GLOBAL PARA TELEMETRÍA EN VIVO (ESP32 / SUPABASE)
  // ==========================================================================
  window.actualizarHumedadUI = function (porcentaje) {
    const clamped = Math.max(0, Math.min(100, porcentaje));
    const moistureValEl = document.getElementById('moisture-val');
    const gaugeArc = document.getElementById('gauge-arc');

    if (moistureValEl) moistureValEl.textContent = clamped;
    if (gaugeArc) {
      const maxDash = 251.3;
      const offset = maxDash - (clamped / 100) * maxDash;
      gaugeArc.style.strokeDashoffset = offset.toFixed(1);
    }
  };
});