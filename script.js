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
    const correlationChartCanvas = document.getElementById('correlation-chart').getContext('2d');
    let correlationChart = null; // Keep track of the chart instance


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
            // We don't need to wait for geocoding to finish before fetching weather,
            // but we need lat/lng for the weather prompt.
            // Let's fetch geocoding results first and then proceed.
            const geocodeResult = await geocodeLocation(locationString);

            const lat = geocodeResult.latitude;
            const lng = geocodeResult.longitude;

            // Determine if it's likely daytime based on hour (simplified)
            const isDaytime = hour >= 6 && hour < 18;

            const weatherPrompt = `Provide realistic weather data for Latitude ${lat}, Longitude ${lng} on ${year}-${month}-${day} at ${hour}:00 local time.
            Assume typical conditions for the ${season} at that time of year and day at this location.
            Include Temperature (°C), Humidity (%), Pressure (hPa), Direct Normal Irradiance (DNI, W/m²), Global Horizontal Irradiance (GHI, W/m²), Global Normal Irradiance (GNI, W/m²), Solar Zenith Angle (deg), Wind Speed (m/s), Cloud Ceiling (m), and Visibility (km).
            If it is not daytime (hour < 6 or hour >= 18), set DNI, GHI, and GNI to 0.
            Respond directly with JSON, following this JSON schema, and no other text.
            {
              "Temperature": number;
              "Humidity": number;
              "Pressure": number;
              "DNI": number;
              "GHI": number;
              "GNI": number;
              "SolarZenith": number;
              "WindSpeed": number;
              "CloudCeiling": number;
              "Visibility": number;
            }`;

            const weatherCompletion = await websim.chat.completions.create({
                messages: [
                    { role: "system", content: "You are a helpful assistant that provides simulated realistic weather data based on location (lat/lng), date, time, and season." },
                    { type: "text", role: "user", content: weatherPrompt }
                ],
                json: true,
            });

            const weatherData = JSON.parse(weatherCompletion.content);

            // Ensure irradiance values are 0 at night based on our simple daytime check
            if (!isDaytime) {
                weatherData.DNI = 0;
                weatherData.GHI = 0;
                weatherData.GNI = 0;
            } else {
                 // For daytime, ensure irradiance is not excessively high if other factors suggest limited sun
                 // This is a simple heuristic based on humidity or cloud ceiling
                 if (weatherData.Humidity > 70 || weatherData.CloudCeiling < 1000) {
                     weatherData.DNI = Math.min(weatherData.DNI, 500); // Cap DNI
                     weatherData.GHI = Math.min(weatherData.GHI, 600); // Cap GHI
                     weatherData.GNI = Math.min(weatherData.GNI, 550); // Cap GNI
                 }
            }


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

            // The API expects the Season as an integer or string. Need to check the model's training.
            // Assuming it expects a string for now based on previous examples. If not, this would need mapping.
            // Given the API worked previously, sending the string "Summer" in the example payload, it likely expects the string.

            const predictionResultRaw = await predict(predictionPayload);

            // Check the structure of predictionResultRaw based on the API response format
            const predictedPower = predictionResultRaw && predictionResultRaw.predicted_label !== undefined
                ? predictionResultRaw.predicted_label
                : null; // Handle case where predicted_label is missing or null

            populateWeatherTable(weatherData);
            // Display predicted power, show '-' if null or not a number
            // Ensure predicted power is not negative, clamp at 0
            predictedPowerSpan.textContent = typeof predictedPower === 'number' ? Math.max(0, predictedPower).toFixed(2) : (predictedPower || '-');


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
        try {
            const completion = await websim.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `Given a location string (City, Country), determine its latitude and longitude.
                    Respond directly with JSON, following this JSON schema, and no other text.
                    If the location cannot be found or is ambiguous, provide default coordinates (e.g., for New York City: 40.7128, -74.0060) and indicate that the exact location wasn't found.
                    {
                        latitude: number;
                        longitude: number;
                        locationFound: boolean;
                    }`
                    },
                    {
                        role: "user",
                        content: [{ type: "text", text: `Geocode the following location: ${location}` }],
                    },
                ],
                json: true,
            });

            const result = JSON.parse(completion.content);
            let lat = result.latitude;
            let lng = result.longitude;
            let locationFound = result.locationFound;

            // Use provided lat/lng if locationFound is true, otherwise use defaults
            if (locationFound) {
                map.setView([lat, lng], 10);
            } else {
                console.warn(`Could not find coordinates for "${location}". Using default.`);
                lat = 40.7128; // Default lat for NYC
                lng = -74.0060; // Default lng for NYC
                map.setView([lat, lng], 13);
                // Display message only if user provided input but location wasn't found precisely
                if (location && location.trim() !== ',') {
                   errorMessage.textContent = `Could not find exact location for "${location}". Showing approximate location (New York, USA).`;
                   errorMessage.classList.remove('d-none');
                }
            }

            if (currentMarker) {
                map.removeLayer(currentMarker);
            }

            currentMarker = L.marker([lat, lng]).addTo(map)
                .bindPopup(`Selected Location: ${location || 'Not specified'}${locationFound ? '' : ' (Approximate)'}`)
                .openPopup();

            return { latitude: lat, longitude: lng, locationFound: locationFound };

        } catch (error) {
            console.error("Error geocoding location:", error);
            if (currentMarker) {
                map.removeLayer(currentMarker);
                currentMarker = null;
            }
            // Fallback to default NYC view on geocoding error
            map.setView([40.7128, -74.0060], 13);
            errorMessage.textContent = 'Failed to find location coordinates. Displaying default map view.';
            errorMessage.classList.remove('d-none');
            // Return default coordinates on error, indicate location was not found
            return { latitude: 40.7128, longitude: -74.0060, locationFound: false };
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

    function setupCorrelationChart() {
        if (correlationChart) {
            correlationChart.destroy(); // Destroy existing chart if it exists
        }

        // Create a scatter plot with data points reflecting:
        // Max power around 125 watts.
        // Peak around 50-60% humidity.
        // Increasing power as humidity goes up *towards the peak*, then decreasing,
        // with a slower decrease/stagnation between 60% and ~85%, then dropping sharply.
        // Data points stop around 95% humidity.
        const dummyData = [
            { x: 0, y: 10 },
            { x: 10, y: 30 },
            { x: 20, y: 60 },
            { x: 30, y: 90 },
            { x: 40, y: 115 },
            { x: 50, y: 124 }, // Nearing peak
            { x: 55, y: 125 }, // Peak
            { x: 60, y: 124 }, // Just past peak
            { x: 70, y: 122 },
            { x: 80, y: 118 }, // Still relatively high
            { x: 85, y: 110 }, // Starting sharper drop
            { x: 90, y: 80 },
            { x: 95, y: 40 } // Data stops around 95% humidity
        ];

        correlationChart = new Chart(correlationChartCanvas, {
            type: 'scatter', // Scatter plot is good for showing correlation
            data: {
                datasets: [{
                    label: 'Humidity vs PolyPwr',
                    data: dummyData,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                    borderColor: 'rgba(75, 192, 192, 1)',
                    borderWidth: 1,
                    pointRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'linear', // Use linear scale for numerical data
                        position: 'bottom',
                        title: {
                            display: true,
                            text: 'Humidity (%)' // Example Axis Label
                        },
                        min: 0,
                        max: 100 
                    },
                    y: {
                        type: 'linear',
                        position: 'left',
                        title: {
                            display: true,
                            text: 'PolyPwr (watts)' // Example Axis Label
                        },
                        min: 0, 
                        max: 150 
                    }
                },
                plugins: {
                    title: {
                        display: true,
                        text: 'Example Correlation: Humidity vs PolyPwr'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `Humidity: ${context.parsed.x}%, Power: ${context.parsed.y}W`;
                            }
                        }
                    }
                }
            }
        });
    }

    setupCorrelationChart(); 
});