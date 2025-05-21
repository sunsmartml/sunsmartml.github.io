document.addEventListener('DOMContentLoaded', function() {
    // Initialize map
    const map = L.map('map').setView([40.7128, -74.0060], 13); // Default to NYC
    let currentMarker = null; // Keep track of the current marker

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // Get elements
    const cityInput = document.getElementById('city');
    const countryInput = document.getElementById('country');
    const yearSelect = document.getElementById('year');
    const monthSelect = document.getElementById('month');
    const daySelect = document.getElementById('day');
    const hourSelect = document.getElementById('hour');
    const dateError = document.getElementById('date-error');
    const generateButton = document.getElementById('generate-prediction');
    const loadingIndicator = document.getElementById('loading-indicator');
    const errorMessage = document.getElementById('error-message');
    const weatherDataTbody = document.getElementById('weather-data-tbody');
    const predictedPowerSpan = document.getElementById('predicted-power');

    // Initial state: Clear weather data and prediction
    weatherDataTbody.innerHTML = '<tr><td colspan="10" class="text-center">Enter location and date/time, then click "Generate Prediction".</td></tr>';
    predictedPowerSpan.textContent = '-';
    errorMessage.classList.add('d-none');

    // Populate year select dynamically (2017-2025)
    const currentYear = new Date().getFullYear();
    yearSelect.innerHTML = ''; // Clear existing options
    for (let i = 2025; i >= 2017; i--) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        yearSelect.appendChild(option);
    }
    // Set the default year to 2025
    yearSelect.value = 2025;

    function validateDate() {
        const year = parseInt(yearSelect.value);
        const month = parseInt(monthSelect.value);
        const day = parseInt(daySelect.value);

        // Create a date object - Date object handles month index (0-11)
        const date = new Date(year, month - 1, day);

        // Check if the date object is valid and the day matches the input day
        // This correctly handles cases like Feb 30th or April 31st
        const isValid = date.getFullYear() === year &&
                        date.getMonth() === month - 1 &&
                        date.getDate() === day;

        if (isValid) {
            dateError.classList.add('d-none');
            return true;
        } else {
            dateError.classList.remove('d-none');
            weatherDataTbody.innerHTML = '<tr><td colspan="10" class="text-center">Invalid date selected. Please correct.</td></tr>';
            predictedPowerSpan.textContent = '-';
            return false;
        }
    }

    // Add listeners for date validation and clearing results
    yearSelect.addEventListener('change', validateDate);
    monthSelect.addEventListener('change', validateDate);
    daySelect.addEventListener('change', validateDate);
    cityInput.addEventListener('input', clearResults);
    countryInput.addEventListener('input', clearResults);
    yearSelect.addEventListener('change', clearResults);
    monthSelect.addEventListener('change', clearResults);
    daySelect.addEventListener('change', clearResults);
    hourSelect.addEventListener('change', clearResults);

    function clearResults() {
        weatherDataTbody.innerHTML = '<tr><td colspan="10" class="text-center">Enter location and date/time, then click "Generate Prediction".</td></tr>';
        predictedPowerSpan.textContent = '-';
        errorMessage.classList.add('d-none');
    }

    function determineSeason(month, day) {
        // Note: Simplified season determination based on month/day ranges, northern hemisphere bias
        if (month < 3 || (month === 3 && day < 20)) {
            return "Winter";
        } else if (month < 6 || (month === 6 && day < 21)) {
            return "Spring";
        } else if (month < 9 || (month === 9 && day < 23)) {
            return "Summer";
        } else if (month < 12 || (month === 12 && day < 21)) {
            return "Fall";
        } else {
            return "Winter"; // Covers Dec 21 onwards
        }
    }

    function calculateTrigFeatures(month, hour) {
        const monthRad = (month - 1) * (2 * Math.PI / 12); // Month 1-12 -> 0 to 11/12 of circle
        const hourRad = hour * (2 * Math.PI / 24); // Hour 0-23 -> 0 to 23/24 of circle
        return {
            cos_mon: Math.cos(monthRad),
            sine_mon: Math.sin(monthRad),
            cos_hr: Math.cos(hourRad),
            sine_hr: Math.sin(hourRad)
        };
    }

    const PREDICTION_ENDPOINT = 'https://askai.aiclub.world/af9ffcbc-4f97-45c7-a304-eb48c361355e';
    async function predict(data) {
        try {
            const res = await fetch(PREDICTION_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
            });

            if (!res.ok) {
                const errorText = await res.text();
                console.error("Prediction API Error Response:", errorText);
                throw new Error(`Prediction API returned status ${res.status}`);
            }

            const response = await res.json();
            // The API returns a body property which is a JSON string itself
            return JSON.parse(response.body);

        } catch (err) {
            console.error('Error during prediction fetch:', err);
            throw err;
        }
    }

    async function getWeatherData(lat, lng, year, month, day, hour) {
        const API_KEY = '485af91bfe3744839b9183119252105';
        const url = `http://api.weatherapi.com/v1/current.json?key=${API_KEY}&q=${lat},${lng}&aqi=no`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Weather API returned status ${response.status}`);
            }
            const data = await response.json();

            // Map the current weather data to our format
            return {
                Temperature: data.current.temp_c,
                Humidity: data.current.humidity,
                Pressure: data.current.pressure_mb,
                DNI: data.current.cloud < 50 ? 800 : 400, // Estimate based on cloud cover
                GHI: data.current.cloud < 50 ? 1000 : 500,
                GNI: data.current.cloud < 50 ? 900 : 450,
                SolarZenith: 90 - (data.current.is_day ? 45 : 0), // Rough estimate
                WindSpeed: data.current.wind_kph / 3.6, // Convert km/h to m/s
                CloudCeiling: (100 - data.current.cloud) * 100, // Rough estimate in meters
                Visibility: data.current.vis_km
            };
        } catch (error) {
            console.error('Error fetching weather data:', error);
            throw error;
        }
    }

    generateButton.addEventListener('click', async function() {
        if (!validateDate()) {
            return;
        }

        const city = cityInput.value.trim();
        const country = countryInput.value.trim();
        const year = parseInt(yearSelect.value);
        const month = parseInt(monthSelect.value);
        const day = parseInt(daySelect.value);
        const hour = parseInt(hourSelect.value);
        const season = determineSeason(month, day);

        if (!city || !country) {
            errorMessage.textContent = 'Please enter both City and Country.';
            errorMessage.classList.remove('d-none');
            clearResults();
            return;
        } else {
            errorMessage.classList.add('d-none');
        }

        loadingIndicator.classList.remove('d-none');
        generateButton.disabled = true;
        clearResults();

        try {
            const locationString = `${city}, ${country}`;
            const geocodeResult = await geocodeLocation(locationString);

            const lat = geocodeResult.latitude;
            const lng = geocodeResult.longitude;

            const weatherData = await getWeatherData(lat, lng, year, month, day, hour);

            const trigFeatures = calculateTrigFeatures(month, hour);

            const predictionPayload = {
                "Humidity": weatherData.Humidity,
                "AmbientTemp": weatherData.Temperature,
                "Visibility": weatherData.Visibility,
                "Pressure": weatherData.Pressure,
                "Wind.Speed": weatherData.WindSpeed,
                "Cloud.Ceiling": weatherData.CloudCeiling,
                "cos_mon": trigFeatures.cos_mon,
                "sine_mon": trigFeatures.sine_mon,
                "cos_hr": trigFeatures.cos_hr,
                "sine_hr": trigFeatures.sine_hr,
                "Season": season
            };

            const predictionResultRaw = await predict(predictionPayload);

            // Check the structure of predictionResultRaw based on the API response format
            const predictedPowerRaw = predictionResultRaw && predictionResultRaw.predicted_label !== undefined
                ? predictionResultRaw.predicted_label
                : null; // Handle case where predicted_label is missing or null

            // Apply scaling factor (multiply by 19)
            const predictedPowerScaled = typeof predictedPowerRaw === 'number'
                ? predictedPowerRaw * 19
                : null;

            populateWeatherTable(weatherData);
            // Display predicted power, show '-' if null or not a number
            // Ensure predicted power is not negative, clamp at 0
            predictedPowerSpan.textContent = typeof predictedPowerScaled === 'number' ? Math.max(0, predictedPowerScaled).toFixed(2) : '-';

        } catch (error) {
            console.error("Error generating prediction:", error);
            if (error.message && error.message.includes('Prediction API')) {
                errorMessage.textContent = `Prediction failed: ${error.message}`;
            } else {
                errorMessage.textContent = 'Failed to generate prediction. Please check inputs and try again.';
            }
            errorMessage.classList.remove('d-none');
            weatherDataTbody.innerHTML = '<tr><td colspan="10" class="text-center">Error fetching data or generating prediction.</td></tr>';
            predictedPowerSpan.textContent = '-';

        } finally {
            loadingIndicator.classList.add('d-none');
            generateButton.disabled = false;
        }
    });

    async function geocodeLocation(location) {
        const API_KEY = '485af91bfe3744839b9183119252105';
        const url = `http://api.weatherapi.com/v1/search.json?key=${API_KEY}&q=${encodeURIComponent(location)}`;

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Geocoding API returned status ${response.status}`);
            }
            
            const results = await response.json();
            
            if (results && results.length > 0) {
                const firstResult = results[0];
                const lat = firstResult.lat;
                const lng = firstResult.lon;
                
                map.setView([lat, lng], 10);
                
                if (currentMarker) {
                    map.removeLayer(currentMarker);
                }

                currentMarker = L.marker([lat, lng]).addTo(map)
                    .bindPopup(`Selected Location: ${firstResult.name}, ${firstResult.country}`)
                    .openPopup();

                return { 
                    latitude: lat, 
                    longitude: lng, 
                    locationFound: true 
                };
            } else {
                throw new Error('No results found');
            }

        } catch (error) {
            console.error("Error geocoding location:", error);
            if (currentMarker) {
                map.removeLayer(currentMarker);
                currentMarker = null;
            }
            throw new Error('Could not find location coordinates');
        }
    }

    function populateWeatherTable(weatherData) {
        weatherDataTbody.innerHTML = '';

        if (!weatherData) {
            weatherDataTbody.innerHTML = '<tr><td colspan="10" class="text-center">No weather data available.</td></tr>';
            return;
        }

        const tr = document.createElement('tr');

        const keys = [
            'Temperature', 'Humidity', 'Pressure', 'DNI', 'GHI', 'GNI',
            'SolarZenith', 'WindSpeed', 'CloudCeiling', 'Visibility'
        ];

        keys.forEach(key => {
            const td = document.createElement('td');
            const value = weatherData[key];
            // Check if value is a number and not null/undefined before calling toFixed
             let displayValue = '-';
             if (typeof value === 'number' && value !== null && value !== undefined) {
                 displayValue = value.toFixed(1);
             } else if (value !== null && value !== undefined) {
                 // Handle potential non-numeric data returned by AI if necessary
                 displayValue = value.toString();
             }
             td.textContent = displayValue;
            tr.appendChild(td);
        });

        weatherDataTbody.appendChild(tr);
    }
});