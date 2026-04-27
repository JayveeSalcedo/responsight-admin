-- This script populates the incident_reports table with mock data distributed 
-- across Urdaneta City so you can properly visualize the Choropleth map.
-- It dynamically fetches a user_id from your users table to satisfy the NOT NULL constraint.

DO $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Get the first available user ID
    SELECT id INTO v_user_id FROM users LIMIT 1;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'No user found in the users table. Please register at least one user before running this script.';
    END IF;

    INSERT INTO incident_reports (
      incident_type, 
      title, 
      description, 
      location, 
      status, 
      severity, 
      latitude, 
      longitude, 
      created_at,
      user_id
    ) VALUES 
    -- Anonas Area
    ('fire', 'Structural Fire in Anonas', 'Fire reported near the barangay hall.', 'Anonas, Urdaneta', 'responding', 'urgent', 16.005, 120.580, NOW(), v_user_id),
    ('medical', 'Medical Emergency', 'Elderly patient experiencing chest pains.', 'Anonas, Urdaneta', 'pending', 'high', 15.998, 120.585, NOW() - INTERVAL '15 minutes', v_user_id),
    ('accident', 'Motorcycle Collision', 'Two motorcycles collided at the intersection.', 'Anonas, Urdaneta', 'verified', 'medium', 15.992, 120.582, NOW() - INTERVAL '1 hour', v_user_id),

    -- Poblacion Area
    ('crime', 'Theft in Commercial Area', 'Shoplifting incident reported at a local store.', 'Poblacion, Urdaneta', 'pending', 'low', 15.976, 120.571, NOW() - INTERVAL '30 minutes', v_user_id),
    ('medical', 'Pedestrian Struck', 'Pedestrian hit by a tricycle.', 'Poblacion, Urdaneta', 'responding', 'high', 15.978, 120.572, NOW() - INTERVAL '5 minutes', v_user_id),
    ('accident', 'Traffic Accident', 'Minor fender bender near the plaza.', 'Poblacion, Urdaneta', 'verified', 'low', 15.974, 120.569, NOW() - INTERVAL '2 hours', v_user_id),
    ('fire', 'Electrical Post Sparking', 'Sparks seen from a transformer.', 'Poblacion, Urdaneta', 'responding', 'high', 15.977, 120.570, NOW(), v_user_id),
    ('crime', 'Public Disturbance', 'Loud altercation near the market.', 'Poblacion, Urdaneta', 'pending', 'medium', 15.975, 120.573, NOW() - INTERVAL '45 minutes', v_user_id),

    -- Nancayasan Area
    ('accident', 'Highway Crash', 'Multi-vehicle collision on the main highway.', 'Nancayasan, Urdaneta', 'responding', 'urgent', 15.960, 120.570, NOW() - INTERVAL '10 minutes', v_user_id),
    ('flood', 'Flooded Street', 'Street impassable due to heavy rain overflow.', 'Nancayasan, Urdaneta', 'verified', 'medium', 15.962, 120.568, NOW() - INTERVAL '3 hours', v_user_id),

    -- San Vicente Area
    ('medical', 'Heat Exhaustion', 'Individual collapsed from heat.', 'San Vicente, Urdaneta', 'pending', 'medium', 15.980, 120.560, NOW() - INTERVAL '20 minutes', v_user_id),
    ('crime', 'Vandalism', 'Graffiti on public property.', 'San Vicente, Urdaneta', 'verified', 'low', 15.985, 120.565, NOW() - INTERVAL '5 hours', v_user_id),
    ('fire', 'Grass Fire', 'Dry brush caught fire near residential area.', 'San Vicente, Urdaneta', 'responding', 'high', 15.982, 120.562, NOW(), v_user_id),

    -- Dilan Paurido Area
    ('medical', 'Respiratory Issue', 'Patient having severe asthma attack.', 'Dilan Paurido, Urdaneta', 'responding', 'high', 15.965, 120.585, NOW() - INTERVAL '8 minutes', v_user_id),
    ('accident', 'Bicycle Incident', 'Cyclist hit a pothole and fell.', 'Dilan Paurido, Urdaneta', 'pending', 'low', 15.968, 120.588, NOW() - INTERVAL '1 hour', v_user_id),

    -- Camantiles Area
    ('flood', 'Rising Water', 'Creek is threatening to overflow onto the road.', 'Camantiles, Urdaneta', 'verified', 'medium', 15.955, 120.590, NOW() - INTERVAL '2 hours', v_user_id),
    ('crime', 'Trespassing', 'Unknown individual in private compound.', 'Camantiles, Urdaneta', 'pending', 'medium', 15.952, 120.595, NOW() - INTERVAL '15 minutes', v_user_id),

    -- Cayambanan Area
    ('fire', 'Kitchen Fire', 'Stove fire in an apartment.', 'Cayambanan, Urdaneta', 'responding', 'urgent', 15.988, 120.550, NOW(), v_user_id),

    -- Nancamaliran West Area
    ('medical', 'Allergic Reaction', 'Severe reaction to food.', 'Nancamaliran West, Urdaneta', 'pending', 'high', 15.990, 120.540, NOW() - INTERVAL '25 minutes', v_user_id),

    -- Macalong Area
    ('accident', 'Tricycle Rollover', 'Tricycle flipped on a sharp turn.', 'Macalong, Urdaneta', 'verified', 'medium', 15.975, 120.580, NOW() - INTERVAL '1.5 hours', v_user_id);

END $$;
