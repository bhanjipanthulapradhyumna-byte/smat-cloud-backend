% Nested loops, if/else, and logical conditions
clc; clear;
total = 0;
for i = 1:5
  for j = 1:3
    if mod(i+j, 2) == 0
      total = total + i*j;
    end
  end
end
fprintf('Nested-loop total = %d\n', total);
