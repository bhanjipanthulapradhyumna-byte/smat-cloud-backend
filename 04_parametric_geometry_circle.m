% Parametric circle and geometric measurements
clc; clear; close all;
r = 4;
t = linspace(0,2*pi,500);
x = r*cos(t); y = r*sin(t);
plot(x,y,'b-'); axis equal; grid on;
title('Circle of radius 4'); xlabel('x'); ylabel('y');
fprintf('Radius = %.2f, area = %.4f, circumference = %.4f\n', r, pi*r^2, 2*pi*r);
